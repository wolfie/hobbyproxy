import type Database from "../db/Database.ts";
import mapObject from "./fp/mapObject.ts";
import type Logger from "./Logger.ts";
import type { SystemLogger } from "./Logger.ts";

const STALE_ROUTE = 7 * 24 * 60 * 60 * 1000; // a week

class RouteManager {
  static async create({
    logger,
    db,
    onRouteExpired,
  }: {
    logger: Logger;
    db: Database;
    onRouteExpired: (hostname: string) => void;
  }) {
    const systemLogger = logger.forSystem("route-manager");
    const allEntries = await db.routes.getAll();
    const routeEntries = allEntries.map(
      (route) =>
        [
          route.hostname,
          { target: route.target, lastUpdated: route.lastUpdated },
        ] satisfies [string, any]
    );

    if (routeEntries.length === 0) {
      systemLogger.log(`No routes found.`);
    } else {
      routeEntries.forEach(([hostname, route]) =>
        systemLogger.log(`Caching proxy route: ${hostname} -> ${route.target}`)
      );
    }

    return new RouteManager(
      db,
      Object.fromEntries(routeEntries),
      systemLogger,
      onRouteExpired
    );
  }

  #db;
  #routes;
  #logger;

  private constructor(
    db: Database,
    routes: Record<string, { target: string; lastUpdated: number }>,
    logger: SystemLogger<"route-manager">,
    onRouteExpired: (hostname: string) => void
  ) {
    this.#db = db;
    this.#routes = mapObject(routes, (target) => ({
      ...target,
      lastAccessed: Date.now(),
      lastAccessedDirty: false,
    }));
    this.#logger = logger;

    setInterval(() => {
      Object.entries(this.#routes).forEach(async ([hostname, route]) => {
        if (route.lastAccessedDirty) {
          this.#db.routes.updateLastAccessedTime(hostname, route.lastAccessed);
          route.lastAccessedDirty = false;
        } else if (route.lastUpdated < Date.now() - STALE_ROUTE) {
          logger.log(
            `Deleting stale route: ${hostname} -> ${
              route.target
            } (Last accessed: ${new Date(route.lastAccessed).toISOString()})`
          );
          delete this.#routes[hostname];
          await this.#db.routes.delete(hostname);
          onRouteExpired(hostname);
        }
      });
    }, 60_000);
  }

  get(hostname: string): string | undefined {
    const route = this.#routes[hostname];
    if (route) {
      route.lastAccessed = Date.now();
      route.lastAccessedDirty = true;
      return route.target;
    } else {
      return undefined;
    }
  }

  getAll() {
    return Object.freeze(
      mapObject(this.#routes, (route) => ({
        ...route,
        lastAccessed: new Date(route.lastAccessed).toISOString(),
      }))
    );
  }

  async set(hostname: string, target: string) {
    this.#logger.log(`Setting route: ${hostname} -> ${target}`);
    this.#routes[hostname] = {
      target,
      lastUpdated: Date.now(),
      lastAccessed: this.#routes[hostname]?.lastAccessed ?? Date.now(),
      lastAccessedDirty: false,
    };
    await this.#db.routes.set(hostname, target);
    return true;
  }

  async delete(hostname: string) {
    this.#logger.log(`Deleting route: ${hostname}`);
    delete this.#routes[hostname];
    const result = await this.#db.routes.delete(hostname);
    return result[0].numDeletedRows;
  }
}

export default RouteManager;
