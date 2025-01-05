import path from "path";
import fs from "fs/promises";

export const ACME_PATH = path.resolve(process.cwd(), "acme");
export const CERTS_PATH = path.resolve(ACME_PATH, "certificates");
export const ACME_PRIVATE_KEY_PATH = path.resolve(
  ACME_PATH,
  "acmePrivateKey.pem"
);

console.log(`Ensuring ${ACME_PATH} exists.`);
await fs.mkdir(ACME_PATH, { recursive: true });

console.log(`Ensuring ${CERTS_PATH} exists.`);
await fs.mkdir(CERTS_PATH, { recursive: true });
