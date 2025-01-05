import { createServer } from "https";
import fs from "fs";
import express, { type RequestHandler } from "express";
import proxy from "express-http-proxy";
import isLanAddress from "./lib/fp/isLanAddress.ts";
import type { default as Logger, SystemLogger } from "./lib/Logger.ts";
import z from "zod";
import { dirname } from "path";
import { fileURLToPath } from "url";
import type DnsManager from "./lib/DnsManager.ts";
import path from "path";
import type CertificatesManager from "./lib/CertificatesManager.ts";
import config from "./config.ts";
import type RouteManager from "./lib/RouteManager.ts";
import { isIP } from "net";

const handleFavicon = (logger: SystemLogger<"http">): RequestHandler => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const faviconPath = path.resolve(__dirname, "favicon.png");
  const faviconContents = fs.readFileSync(faviconPath);
  logger.log(`Loaded ${faviconContents.byteLength} bytes from ${faviconPath}`);

  return ((_req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", faviconContents.byteLength);
    res.send(faviconContents);
  }) satisfies RequestHandler;
};

const NewContextBody = z.object({
  hostname: z.string(),
  target: z.string().url().optional(),
});

const ensureHttps = (): RequestHandler => (req, res, next) =>
  req.secure || isLanAddress(req.hostname)
    ? next()
    : res.redirect("https://" + req.hostname + req.originalUrl);

const getAddress = (req: express.Request) => {
  const addr = req.socket.address();
  return "address" in addr ? addr.address : undefined;
};

const startHttpsServer = async (opts: {
  logger: Logger;
  dnsManager: DnsManager;
  certificatesManager: CertificatesManager;
  routeManager: RouteManager;
}) => {
  const logger = opts.logger.forSystem("http");

  logger.log("Starting HTTP/HTTPS server servers");
  const app = express();
  app.disable("x-powered-by");

  const httpsServer = createServer(
    {
      SNICallback: async (servername, callback) => {
        if (!opts.routeManager.get(servername)) {
          if (servername.endsWith(opts.dnsManager.zoneName)) {
            logger.log(
              `No route set for ${servername}; ignoring certificate request`
            );
          }
          callback(new Error("No such host"));
        } else {
          callback(
            null,
            await opts.certificatesManager.getSecureContext(servername)
          );
        }
      },
    },
    app
  );

  app.get("/.well-known/acme-challenge/:token", async (req, res, next) => {
    const key = opts.certificatesManager.getAcmeChallenge(
      req.hostname,
      req.params.token
    );
    if (!key) next();
    res.setHeader("Content-Type", "plain/text").send(key);
  });

  // Stop processing unsupported requests from this point on.
  app.use((req, res, next) => {
    if (isLanAddress(req.hostname) || opts.routeManager.get(req.hostname)) {
      next();
    } else {
      if (req.hostname?.endsWith(opts.dnsManager.zoneName)) {
        // suppress logging for direct ip access
        logger.log(
          `No proxy set up for ${req.hostname}${req.originalUrl} [requested by ${req.socket.remoteAddress}]`
        );
      }
      req.socket.destroy();
    }
  });

  app.use(ensureHttps());
  app.use(
    "/",

    proxy((req) => opts.routeManager.get(req.hostname) ?? "", {
      filter: (req) =>
        !isLanAddress(req.hostname) && !!opts.routeManager.get(req.hostname),
    })
  );

  app.get("/favicon.ico", handleFavicon(logger));

  app.get("/", (req, res) => {
    res.json({
      routes: opts.routeManager.getAll(),
      logs: opts.logger.logsFormatted,
    });
  });

  app.post("/", express.json(), async (req, res) => {
    const bodyResult = NewContextBody.safeParse(req.body);
    if (bodyResult.success) {
      if (!bodyResult.data.hostname.endsWith(opts.dnsManager.zoneName)) {
        const error = `Requested hostname ${bodyResult.data.hostname} does not end with zone name ${opts.dnsManager.zoneName} - ignoring request`;
        logger.error(error);
        res.status(400).send({ ok: false, error });
        return;
      }

      logger.log(
        `Received a request for a route for ${bodyResult.data.hostname} from ${req.socket.remoteAddress}`
      );

      let target = bodyResult.data.target;
      if (!target) {
        const address = getAddress(req);
        target = `http://${address}`;
        logger.log(`No target was given, using ${target} instead`);
      }

      await Promise.all([
        opts.dnsManager.upsertDnsEntry(bodyResult.data.hostname),
        opts.routeManager.set(bodyResult.data.hostname, target),
      ]);
      res.send({ ok: true });
    } else {
      res.status(400);
      res.send({ ok: false, error: bodyResult.error });
    }
  });

  app.use((req, res) => {
    logger.log(
      `Unhandled ${req.method} request to ${req.hostname}/${req.originalUrl} [requested by ${req.socket.remoteAddress}]`
    );
    res.status(400).send("<h1>400 Go Away</h1>");
  });

  httpsServer.listen(config.httpsPort, "0.0.0.0", () =>
    logger.log(
      `🔑 HTTPS Server started on https://localhost:${config.httpsPort}`
    )
  );
  app.listen(config.httpPort, "0.0.0.0", () =>
    logger.log(`🔓 HTTP Server started on http://localhost:${config.httpPort}`)
  );
};

export default startHttpsServer;
