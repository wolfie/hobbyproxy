import acme from "acme-client";
import readFileOrUndefined from "./fp/readFileOrEmpty.ts";
import prompts from "prompts";
import fs from "fs/promises";
import { ACME_PRIVATE_KEY_PATH } from "./CertificatesManager.paths.ts";
import config from "../config.ts";
import type { SystemLogger } from "./Logger.ts";

const createNewAccount = async (
  logger: SystemLogger<"certificates-manager">
) => {
  logger.log(`File ${ACME_PRIVATE_KEY_PATH} not found.`);
  const { createKey } = await prompts({
    type: "confirm",
    name: "createKey",
    message: `Create a new ACME account private key now?`,
    initial: true,
  });

  if (!createKey) {
    logger.error("Private key required for operations. Aborting.");
    process.exit(1);
  }

  const accountPrivateKey = await acme.crypto.createPrivateKey();
  await fs.writeFile(ACME_PRIVATE_KEY_PATH, accountPrivateKey);
  logger.log("New private key created");

  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey: accountPrivateKey,
  });

  logger.log("Creating new account");
  const account = await client.createAccount({
    contact: [`mailto:${config.acme.email}`],
    termsOfServiceAgreed: true,
  });

  logger.log("Done. Please restart the server now.");
  process.exit(0);
};

const createAcmeClient = async (
  logger: SystemLogger<"certificates-manager">
) => {
  const accountPrivateKey = await readFileOrUndefined(
    ACME_PRIVATE_KEY_PATH,
    "utf8"
  );
  if (!accountPrivateKey) return await createNewAccount(logger); // returns `never` - exits after done. It doesn't have to be that way, but at the time it felt nice to be more explicit of what's happening

  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.production,
    accountKey: accountPrivateKey,
  });

  const account = await client.createAccount({ onlyReturnExisting: true }); // make sure account exists
  if (!account.contact?.includes(`mailto:${config.acme.email}`)) {
    logger.log(
      `Account doesn't have ${
        config.acme.email
      } as a contact. Adding it (${JSON.stringify(account.contact)})`
    );
    client.updateAccount({
      contact: [...(account.contact ?? []), `mailto:${config.acme.email}`],
    });
  }
  return client;
};

export default createAcmeClient;
