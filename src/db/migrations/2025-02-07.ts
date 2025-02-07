import { Kysely } from "kysely";
import exec from "./exec.ts";

export const up = async (db: Kysely<any>) => {
  await exec(
    db.schema.alterTable("routes").addColumn("staleInDays", "numeric")
  );
  await exec(db.updateTable("routes").set("staleInDays", 7));
};
