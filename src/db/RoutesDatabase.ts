import type { Kysely } from "kysely";
import type { Database } from "./schema.ts";
import type Logger from "../lib/Logger.ts";

class RoutesDatabase {
  #logger;
  #db;

  constructor(db: Kysely<Database>, logger: Logger) {
    this.#logger = logger.forSystem("routes-database");
    this.#db = db;
  }

  getHost = async (hostname: string) => {
    const result = await this.#db
      .selectFrom("routes")
      .selectAll()
      .where("hostname", "=", hostname)
      .execute();

    if (result.length > 1) {
      this.#logger.error(
        `Got multiple results for hostname "${hostname}": ${result
          .map((x) => x.target)
          .join(", ")}`
      );
    }

    return result.at(0);
  };

  getAll = () => this.#db.selectFrom("routes").selectAll().execute();

  set(hostname: string, target: string, staleInDays: number | undefined) {
    const now = new Date();
    return this.#db
      .insertInto("routes")
      .values({
        hostname,
        target,
        added: now.toISOString(),
        lastAccessed: now.getTime(),
        lastUpdated: now.getTime(),
        staleInDays,
      })
      .onConflict((oc) =>
        oc.column("hostname").doUpdateSet({
          target,
          lastUpdated: now.getTime(),
          staleInDays,
        })
      )
      .execute();
  }

  delete(hostname: string) {
    return this.#db
      .deleteFrom("routes")
      .where("hostname", "=", hostname)
      .execute();
  }

  updateLastAccessedTime(hostname: string, now: number) {
    return this.#db
      .updateTable("routes")
      .set("lastAccessed", now)
      .where("hostname", "=", hostname).execute;
  }
}

export default RoutesDatabase;
