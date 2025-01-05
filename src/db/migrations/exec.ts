import { CompiledQuery } from "kysely";

const exec = (query: {
  compile: () => CompiledQuery;
  execute: () => Promise<unknown>;
}) => {
  console.log(query.compile().sql);
  return query.execute();
};

export default exec;
