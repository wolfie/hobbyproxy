import { Kysely } from "kysely";
import exec from "./exec.ts";

export const up = async (db: Kysely<any>) => {
  await exec(
    db.schema
      .createTable("certificates")
      .addColumn("hostname", "text", (col) => col.primaryKey().notNull())
      .addColumn("updatedAt", "text", (col) => col.notNull())
      .addColumn("expiresOn", "text", (col) => col.notNull())
  );

  await exec(
    db.schema
      .createTable("logs")
      .addColumn("timestamp", "numeric", (col) => col.notNull())
      .addColumn("level", "text", (col) => col.notNull())
      .addColumn("log", "text", (col) => col.notNull())
      .addColumn("system", "text", (col) => col.notNull())
  );

  await exec(
    db.schema
      .createTable("routes")
      .addColumn("hostname", "text", (col) => col.primaryKey().notNull())
      .addColumn("target", "text", (col) => col.notNull())
      .addColumn("added", "text", (col) => col.notNull())
      .addColumn("lastAccessed", "numeric", (col) => col.notNull())
      .addColumn("lastUpdated", "numeric", (col) => col.notNull())
  );
};
