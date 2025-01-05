import type { Kysely } from "kysely";
import type Logger from "../lib/Logger.ts";
import type { Database, Log } from "./schema.ts";
import { z } from "zod";

const LogLevel = z.literal("log").or(z.literal("error"));

const yesterday = () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.getTime();
};

class LogsDatabase {
  #db;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getAll() {
    const logRows = await this.#db
      .selectFrom("logs")
      .selectAll()
      .orderBy("timestamp desc")
      .execute();

    return logRows.map((log) => ({
      level: LogLevel.parse(log.level),
      timestamp: new Date(log.timestamp),
      system: log.system,
      log: log.log,
    }));
  }

  add(log: Log) {
    return this.#db.insertInto("logs").values(log).execute();
  }

  truncateLogs() {
    return this.#db
      .deleteFrom("logs")
      .where("logs.timestamp", "<", yesterday())
      .execute();
  }
}

export default LogsDatabase;
