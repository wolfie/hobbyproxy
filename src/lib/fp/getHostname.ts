import type { IncomingMessage } from "http";

function getHostname(req: IncomingMessage) {
  const hostHeader = req.headers.host;
  if (!hostHeader) return "";

  // hostHeader might look like "example.com:3000"
  // so split on ":" and take the first part
  const [hostname] = hostHeader.split(":");
  return hostname;
}

export default getHostname;
