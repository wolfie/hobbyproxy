const isEnoent = (e: unknown): boolean =>
  !!e && typeof e === "object" && "code" in e && e.code === "ENOENT";
export default isEnoent;
