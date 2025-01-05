const mapObject = <T extends Record<string, any>, R>(
  rec: T,
  mapper: (x: T[keyof T]) => R
): Record<keyof T, R> =>
  Object.fromEntries(
    Object.entries(rec).map(
      ([key, value]) => [key, mapper(value)] as [string, R]
    )
  ) as Record<keyof T, R>;

export default mapObject;
