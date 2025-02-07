const map =
  <T, R>(mapper: (t: T) => R) =>
  (t: T[]) =>
    t.map(mapper);
export default map;
