import Database from "../db/Database.ts";
import deepFreeze from "./fp/deepFreeze.ts";
import { format } from "util";

type LogEntry = {
  entries: any[];
  level: "log" | "error";
  system: string;
  timestamp: Date;
};

export type SystemLogger<SYSTEM extends string> = {
  log: (...entries: any[]) => Promise<void>;
  error: (...entries: any[]) => Promise<void>;
};

const MAX_LOG_ENTRIES = 50;

const formatLogEntry = (e: LogEntry): string =>
  `${e.timestamp.toISOString()} [${e.level}] [${e.system}] ${format(
    ...e.entries
  )}`;

class Logger {
  #logs: LogEntry[] = [];
  #db: Database | undefined;

  connectDatabase(db: Database) {
    this.#db = db;
    setInterval(() => db.logs.truncateLogs(), 60_000);

    db.logs.getAll().then((logs) =>
      logs.map((log) =>
        this.#logs.push({
          ...log,
          entries: [log.log],
        })
      )
    );
  }

  forSystem<T extends string>(system: T): SystemLogger<T> {
    return {
      log: async (...entries: any[]) => {
        const logEntry = {
          entries,
          system,
          level: "log",
          timestamp: new Date(),
        } satisfies LogEntry;
        this.#logs.unshift(logEntry);
        console.log(formatLogEntry(logEntry));
        this.#capLogLength();
        await this.#db?.logs.add({
          log: format(...entries),
          level: "log",
          system,
          timestamp: logEntry.timestamp.getTime(),
        });
      },

      error: async (...entries: any[]) => {
        const logEntry = {
          entries,
          system,
          level: "error",
          timestamp: new Date(),
        } satisfies LogEntry;
        this.#logs.unshift(logEntry);
        console.error(formatLogEntry(logEntry));
        this.#capLogLength();
        await this.#db?.logs.add({
          log: format(...entries),
          level: "error",
          system,
          timestamp: logEntry.timestamp.getTime(),
        });
      },
    };
  }

  #capLogLength = () => {
    while (this.#logs.length > MAX_LOG_ENTRIES) this.#logs.pop();
  };

  get logs() {
    return deepFreeze(this.#logs);
  }

  get logsFormatted() {
    return this.#logs.map(formatLogEntry);
  }
}

export default Logger;
