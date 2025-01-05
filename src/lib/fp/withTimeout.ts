const withTimeout = <FN extends (...args: any[]) => Promise<any>>(
  fn: FN,
  timeoutMs: number
) =>
  new Promise<Awaited<ReturnType<FN>>>((resolve, reject) => {
    const i = setTimeout(() => reject(new Error("Timeout")), timeoutMs);
    fn()
      .then(resolve)
      .then(() => clearTimeout(i));
  });

export default withTimeout;
