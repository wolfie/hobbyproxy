const safeJsonParse = (str: string) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    return undefined;
  }
};
export default safeJsonParse;
