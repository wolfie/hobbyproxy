import "dotenv/config";
import { FileMigrationProvider, Kysely, Migrator, SqliteDialect } from "kysely";
import SQLite from "better-sqlite3";
import type Logger from "../lib/Logger.ts";
import type { Database as DatabaseSchema } from "./schema.ts";
import RoutesDatabase from "./RoutesDatabase.ts";
import LogsDatabase from "./LogsDatabase.ts";
import CertificatesDatabase from "./CertificatesDatabase.ts";
import config from "../config.ts";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import isEnoent from "../lib/fp/isEnoent.ts";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_PATH = path.resolve(__dirname, "migrations");

class Database {
  readonly routes;
  readonly logs;
  readonly certificates;

  static async create(logger: Logger) {
    const systemLogger = logger.forSystem("database");

    systemLogger.log(`Using ${config.dbPath} for sqlite`);
    const db = new Kysely<DatabaseSchema>({
      dialect: new SqliteDialect({ database: new SQLite(config.dbPath) }),
    });

    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        migrationFolder: MIGRATIONS_PATH,
        fs,
        path: {
          join: (...args) =>
            // https://github.com/kysely-org/kysely/issues/254
            path.join(os.platform() === "win32" ? "file:///" : "", ...args),
        },
      }),
    });

    const shouldBackup = await migrator.getMigrations().then((migrations) => {
      const undoneMigrations = migrations.filter(
        (m) => typeof m.executedAt === "undefined"
      );
      return (
        undoneMigrations.length > 0 &&
        undoneMigrations.length < migrations.length
      );
    });
    if (shouldBackup) {
      const now = new Date();
      const today =
        `${now.getFullYear()}-` +
        `${String(now.getMonth() + 1).padStart(2, "0")}-` +
        `${String(now.getDate()).padStart(2, "0")}`;
      const backupFile = `${config.dbPath}.${today}.bak`;
      try {
        await fs.copyFile(config.dbPath, backupFile);
        systemLogger.log(`Copied a backup of the database into ${backupFile}`);
      } catch (e) {
        if (!isEnoent(e)) throw e;
      }
    }

    const { error, results } = await migrator.migrateToLatest();
    results?.forEach((migration) => {
      if (migration.status === "Success") {
        systemLogger.log(
          `Migration "${migration.migrationName}" was executed successfully`
        );
      } else if (migration.status === "Error") {
        systemLogger.error(
          `Failed to execute migration "${migration.migrationName}"`
        );
      }
    });

    if (error) {
      systemLogger.error("Failed to migrate");
      systemLogger.error(error);
      process.exit(1);
    }

    return new Database(logger, db);
  }

  private constructor(logger: Logger, db: Kysely<DatabaseSchema>) {
    this.routes = new RoutesDatabase(db, logger);
    this.logs = new LogsDatabase(db);
    this.certificates = new CertificatesDatabase(db, logger);
  }
}

export default Database;
