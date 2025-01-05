import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import isEnoent from "./lib/fp/isEnoent.ts";
import { z } from "zod";
import safeJsonParse from "./lib/fp/safeJsonParse.ts";
import prompts from "prompts";
import anyPropIsFalsy from "./lib/fp/anyPropIsFalsy.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../config.json");

const Config = z.object({
  acme: z.object({
    email: z.string().email(),
    tosAccepted: z.boolean(),
  }),
  cloudflareApiToken: z.string(),
  httpPort: z.number(),
  httpsPort: z.number(),
  dbPath: z.string(),
});
type Config = z.TypeOf<typeof Config>;

let config: Config | undefined = undefined;
try {
  console.log(`Reading ${CONFIG_PATH}`);
  const parseResult = Config.safeParse(
    safeJsonParse(await fs.readFile(CONFIG_PATH, "utf8"))
  );
  if (!parseResult.success) {
    console.log("Unsupported JSON format");
  } else {
    config = parseResult.data;
  }
} catch (e) {
  if (isEnoent(e)) {
    console.log("Config file not found, creating new.");
  } else if (e instanceof Error && e.message.endsWith("is not valid JSON")) {
    console.log("Config file not valid JSON");
  } else throw e;
}

if (!config) {
  const acceptTos = await prompts([
    {
      type: "confirm",
      name: "acceptLetsencryptTos",
      message:
        "Do you accept the TOS of Let's Encrypt? (https://community.letsencrypt.org/tos)",
    },
  ]);

  if (!acceptTos.acceptLetsencryptTos) {
    console.error(
      "⚠️ Accepting the TOS is required for the functionality of this software."
    );
    process.exit(1);
  }

  const answers = await prompts([
    {
      type: "text",
      name: "letsencryptEmail",
      message: "Your email (for letsencrypt)",
      initial: "",
      validate: (x: string) => x.includes("@") && x.includes("."),
    },
    {
      type: "password",
      name: "cloudflareKey",
      message:
        "Cloudflare API key (will be saved as plaintext into config file)",
    },
    {
      type: "number",
      name: "httpPort",
      message: "Port for HTTP traffic",
      initial: 8080,
    },
    {
      type: "number",
      name: "httpsPort",
      message: "Port for HTTP traffic",
      initial: 8443,
    },
    {
      type: "text",
      name: "dbPath",
      message: "Path for database",
      initial: path.resolve(process.cwd(), "local.sqlite"),
    },
  ]);

  if (anyPropIsFalsy(answers)) {
    process.exit(1);
  }

  config = {
    acme: {
      email: answers.letsencryptEmail,
      tosAccepted: acceptTos.acceptLetsencryptTos,
    },
    cloudflareApiToken: answers.cloudflareKey,
    httpPort: answers.httpPort,
    httpsPort: answers.httpsPort,
    dbPath: answers.dbPath,
  };

  console.log("Writing config file");
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log("DONE! Please restart the server now.");
  process.exit(0);
}

export default config satisfies Config;
