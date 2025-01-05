import type { Kysely } from "kysely";
import type { Database, NewCertificate } from "./schema.ts";
import type Logger from "../lib/Logger.ts";

class CertificatesDatabase {
  #logger;
  #db;

  constructor(db: Kysely<Database>, logger: Logger) {
    this.#logger = logger.forSystem("certificates-database");
    this.#db = db;
  }

  async upsert(certificate: NewCertificate) {
    const result = await this.#db
      .insertInto("certificates")
      .values(certificate)
      .onConflict((oc) => oc.column("hostname").doUpdateSet(certificate))
      .execute();

    this.#logger.log(
      `Upserted certificate entry: ${JSON.stringify(certificate)}`
    );

    return result.length === 1;
  }

  getAll() {
    return this.#db.selectFrom("certificates").selectAll().execute();
  }

  getExpired() {
    return this.#db
      .selectFrom("certificates")
      .selectAll()
      .where("certificates.expiresOn", "<", new Date().toISOString())
      .execute();
  }

  getExpiringWithinAWeek() {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    return this.#db
      .selectFrom("certificates")
      .selectAll()
      .where("certificates.expiresOn", "<", nextWeek.toISOString())
      .execute();
  }

  delete(hostname: string) {
    return this.#db
      .deleteFrom("certificates")
      .where("certificates.hostname", "=", hostname)
      .execute();
  }
}

export default CertificatesDatabase;
