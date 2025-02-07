import acme from "acme-client";
import type { default as Logger, SystemLogger } from "./Logger.ts";
import type Database from "../db/Database.ts";
import createAcmeClient from "./CertificatesManager.createAcmeClient.ts";
import path from "path";
import fs from "fs/promises";
import isEnoent from "./fp/isEnoent.ts";
import { createSecureContext, SecureContext } from "tls";
import { CERTS_PATH } from "./CertificatesManager.paths.ts";

const STALE_CHALLENGE_TIMEOUT = 5 * 60 * 1000;

const getFilePaths = (hostname: string) => ({
  key: path.resolve(CERTS_PATH, `${hostname}.key.pem`),
  cert: path.resolve(CERTS_PATH, `${hostname}.cert.pem`),
});

const getExistingFilenames = async (
  logger: SystemLogger<"certificates-manager">
) => {
  const files = await fs.readdir(CERTS_PATH);
  return files.reduce((results, file) => {
    if (file.endsWith(".key.pem")) {
      const hostname = file.replace(".key.pem", "");
      results[hostname] = { ...results[hostname], key: file };
    } else if (file.endsWith(".cert.pem")) {
      const hostname = file.replace(".cert.pem", "");
      results[hostname] = { ...results[hostname], cert: file };
    } else {
      logger.log("Unexpected file in certs directory:", file);
    }
    return results;
  }, {} as { [hostname: string]: { cert: string; key: string } });
};

class CertificatesManager {
  #cleanupTimer: any;
  static async create({
    db,
    logger,
    onCertExpired,
  }: {
    db: Database;
    logger: Logger;
    onCertExpired: (hostname: string) => void;
  }) {
    const systemLogger = logger.forSystem("certificates-manager");
    const [existingFilenames, existingDbEntries] = await Promise.all([
      getExistingFilenames(systemLogger),
      db.certificates.getAll(),
    ]);

    const secureContexts: { [hostname: string]: SecureContext } = {};
    for (const dbEntry of existingDbEntries) {
      const filenames = existingFilenames[dbEntry.hostname];
      delete existingFilenames[dbEntry.hostname];
      if (!filenames) {
        systemLogger.error(
          `Database has an entry for ${dbEntry.hostname} that doesn't have a corresponding file. Cleaning up.`
        );
        db.certificates.delete(dbEntry.hostname);
        continue;
      }

      systemLogger.log(
        `Caching secure context for hostname ${dbEntry.hostname}`
      );

      const [key, cert] = await Promise.all([
        fs.readFile(path.resolve(CERTS_PATH, filenames.key)),
        fs.readFile(path.resolve(CERTS_PATH, filenames.cert)),
      ]);
      secureContexts[dbEntry.hostname] = createSecureContext({ key, cert });
    }

    if (Object.keys(existingFilenames).length > 0) {
      systemLogger.error(
        `Found files that don't have a corresponding database entry: ${Object.keys(
          existingFilenames
        ).join(", ")}`
      );

      await Promise.all(
        Object.entries(existingFilenames).map(
          async ([hostname, { cert, key }]) => {
            const results = await Promise.allSettled([
              fs
                .rm(path.resolve(CERTS_PATH, key))
                .then(() => systemLogger.log(`Deleted ${key}`)),
              fs
                .rm(path.resolve(CERTS_PATH, cert))
                .then(() => systemLogger.log(`Deleted ${cert}`)),
            ]);
            const failure = results
              .filter((r) => r.status === "rejected")
              .at(0);
            if (failure) throw failure.reason;
            onCertExpired(hostname);
          }
        )
      );
    }

    const acmeClient = await createAcmeClient(systemLogger);
    return new CertificatesManager(
      db,
      systemLogger,
      acmeClient,
      secureContexts,
      onCertExpired
    );
  }

  #db;
  #logger;
  #acmeClient;
  #secureContexts;

  #ongoingChallenges: {
    [token: string]:
      | {
          keyAuthorization: string;
          hostname: string;
          createdAt: number;
        }
      | undefined;
  } = {};

  private constructor(
    db: Database,
    logger: SystemLogger<"certificates-manager">,
    acmeClient: acme.Client,
    secureContexts: { [hostname: string]: SecureContext },
    onCertExpired: (hostname: string) => void
  ) {
    this.#db = db;
    this.#logger = logger;
    this.#acmeClient = acmeClient;
    this.#secureContexts = secureContexts;

    const cleanUpExpiredCerts = async () => {
      const expiredCerts = await db.certificates.getExpired();
      if (expiredCerts.length === 0) return;

      logger.log(
        `Found ${expiredCerts.length} expired certificate(s): ${expiredCerts
          .map((c) => c.hostname)
          .join(", ")}`
      );

      await Promise.all(
        expiredCerts.map(async (c) => {
          const { key, cert } = getFilePaths(c.hostname);
          const results = await Promise.allSettled([
            fs.rm(key).then(() => logger.log(`Deleted ${key}`)),
            fs.rm(cert).then(() => logger.log(`Deleted ${cert}`)),
          ]);
          const failure = results
            .filter((r) => r.status === "rejected")
            .find((r) => !isEnoent(r.reason));
          if (failure) throw failure.reason;
          onCertExpired(c.hostname);
        })
      );
    };
    setInterval(cleanUpExpiredCerts, 60 * 60 * 1000);
    setInterval(this.#renewExpiringCertificates.bind(this), 60 * 60 * 1000);
  }

  async #renewExpiringCertificates() {
    const [expiringCertificates] = await Promise.all([
      this.#db.certificates.getExpiringWithinAWeek(),
    ]);

    this.#logger.log(
      `Found ${
        expiringCertificates.length
      } cert(s) to renew: ${expiringCertificates
        .map((r) => r.hostname)
        .join(", ")}`
    );
    for (const renewable of expiringCertificates) {
      await this.#applyForCert(renewable.hostname);
    }
  }

  async #getExistingCreateSecureContext(
    hostname: string
  ): Promise<SecureContext | undefined> {
    if (this.#secureContexts[hostname]) {
      return this.#secureContexts[hostname];
    }

    const paths = getFilePaths(hostname);
    const [key, cert] = await Promise.allSettled([
      fs.readFile(paths.key),
      fs.readFile(paths.cert),
    ]);

    if (key.status === "rejected") {
      if (!isEnoent(key.reason)) {
        await this.#logger.error(`Failed reading ${paths.key}`, key.reason);
        throw key.reason;
      }
    }
    if (cert.status === "rejected") {
      if (!isEnoent(cert.reason)) {
        await this.#logger.error(`Failed reading ${paths.cert}`, cert.reason);
        throw cert.reason;
      }
    }

    if (cert.status === "fulfilled" && key.status === "fulfilled") {
      this.#logger.log(`Caching new secure context for hostname "${hostname}"`);
      const secureContext = createSecureContext({
        key: key.value,
        cert: cert.value,
      });
      this.#secureContexts[hostname] = secureContext;
      return secureContext;
    } else {
      return undefined;
    }
  }

  async #applyForCert(hostname: string) {
    const [key, csrBuffer] = await acme.crypto.createCsr({
      altNames: [hostname],
    });

    const cert = await this.#acmeClient.auto({
      csr: csrBuffer,
      challengePriority: ["http-01"],
      challengeCreateFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type !== "http-01") {
          return await this.#logger.log(
            `Rejecting a challenge type ${challenge.type} with token ${challenge.token}`
          );
        }

        this.#logger.log(`Storing token ${challenge.token} for ${hostname}`);
        this.#ongoingChallenges[challenge.token] = {
          keyAuthorization,
          hostname,
          createdAt: Date.now(),
        };
      },
      challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
        this.#logger.log(
          `Cleaning up token ${challenge.token} for ${hostname}`
        );
        delete this.#ongoingChallenges[challenge.token];
      },
    });

    const keyFile = path.resolve(CERTS_PATH, `${hostname}.key.pem`);
    this.#logger.log(`Writing ${hostname} key into ${keyFile}`);
    fs.writeFile(keyFile, key);

    const certFile = path.resolve(CERTS_PATH, `${hostname}.cert.pem`);
    this.#logger.log(`Writing ${hostname} cert into ${certFile}`);
    fs.writeFile(certFile, cert);

    const info = acme.crypto.readCertificateInfo(cert);
    const expiresOn = info.notAfter.toISOString();
    await this.#db.certificates.upsert({
      hostname,
      expiresOn,
      updatedAt: new Date().toISOString(),
    });
    return { key, cert };
  }

  async getSecureContext(hostname: string) {
    const existingSecureContext = await this.#getExistingCreateSecureContext(
      hostname
    );
    if (existingSecureContext) return existingSecureContext;

    this.#logger.log(
      `Existing certificate for ${hostname} not found, applying for a new one.`
    );

    return createSecureContext(await this.#applyForCert(hostname));
  }

  getAcmeChallenge(hostname: string, token: string) {
    const challenge = this.#ongoingChallenges[token];
    if (!challenge) {
      this.#logger.log(
        `ACME challenge with token ${token} not found. (requested for ${hostname})`
      );
      return undefined;
    }
    if (challenge.hostname !== hostname) {
      this.#logger.log(
        `ACME challenge with token ${token} found, but hostnames don't match (requested ${hostname} but got ${challenge.hostname}).`
      );
      return undefined;
    }
    return challenge.keyAuthorization;
  }

  async delete(hostname: string) {
    this.#logger.log(`Deleting certificate files for ${hostname}`);
    const { key, cert } = getFilePaths(hostname);
    const results = await Promise.allSettled([
      fs.rm(key).then(() => this.#logger.log(`Removed ${key}`)),
      fs.rm(cert).then(() => this.#logger.log(`Removed ${cert}`)),
    ]);
    const failure = results
      .filter((r) => r.status === "rejected")
      .filter((r) => !isEnoent(r.reason))
      .at(0);
    if (failure) throw failure.reason;
    this.#logger.log(`Deleteing database entry for ${hostname} certificate`);
    this.#db.certificates.delete(hostname);
    delete this.#secureContexts[hostname];
  }

  #startCleanupTimer() {
    if (this.#cleanupTimer) return;
    this.#cleanupTimer = setTimeout(() => {
      this.#cleanupTimer = undefined;

      Object.entries(this.#ongoingChallenges).forEach(([token, challenge]) => {
        if (!challenge) return;
        if (Date.now() - challenge.createdAt > STALE_CHALLENGE_TIMEOUT) {
          this.#logger.log(
            `Cleaning up stale challenge with token ${token} for ${
              challenge.hostname
            }, was created ${new Date(challenge.createdAt).toISOString()}`
          );
          delete this.#ongoingChallenges[token];
        }
      });

      if (Object.keys(this.#ongoingChallenges).length > 0) {
        this.#startCleanupTimer();
      }
    }, STALE_CHALLENGE_TIMEOUT);
  }
}

export default CertificatesManager;
