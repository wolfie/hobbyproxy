import Logger from "./lib/Logger.ts";
import startServer from "./startServer.ts";
import DnsManager from "./lib/DnsManager.ts";
import Database from "./db/Database.ts";
import CertificatesManager from "./lib/CertificatesManager.ts";
import RouteManager from "./lib/RouteManager.ts";

const logger = new Logger();
const db = await Database.create(logger);
logger.connectDatabase(db);

const [dnsManager, certificatesManager, routeManager] = await Promise.all([
  DnsManager.create({ logger, db }),
  CertificatesManager.create({
    db,
    logger,
    onCertExpired: (hostname) => {
      dnsManager.delete(hostname);
      routeManager.delete(hostname);
    },
  }),
  RouteManager.create({
    logger,
    db,
    onRouteStale: (hostname) => {
      dnsManager.delete(hostname);
      certificatesManager.delete(hostname);
    },
  }),
]);

const rootLogger = logger.forSystem("root");

await startServer({
  logger,
  dnsManager,
  certificatesManager,
  routeManager,
});

process.on("uncaughtException", (e) => rootLogger.error(e));
process.on("unhandledRejection", (e) => rootLogger.error(e));
