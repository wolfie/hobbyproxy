import type Database from "../db/Database.ts";
import type { Route } from "../db/schema.ts";
import mapObject from "./fp/mapObject.ts";
import type Logger from "./Logger.ts";
import type { SystemLogger } from "./Logger.ts";

const DAY_IN_MILLIS = 24 * 60 * 60 * 1000;
const HEARTBEAT_TIMEOUT_MILLIS = 7 * DAY_IN_MILLIS;

class RouteManager {
  static async create({
    logger,
    db,
    onRouteStale,
  }: {
    logger: Logger;
    db: Database;
    onRouteStale: (hostname: string) => void;
  }) {
    const systemLogger = logger.forSystem("route-manager");
    const allEntries = await db.routes.getAll();
    const routeEntries = allEntries.map(
      (route) => [route.hostname, route] satisfies [string, Route]
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
      onRouteStale
    );
  }

  #db;
  #routes;
  #logger;

  private constructor(
    db: Database,
    routes: Record<string, Route>,
    logger: SystemLogger<"route-manager">,
    onRouteStale: (hostname: string) => void
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
        }

        const now = Date.now();
        let cause: "dead" | "unused" | undefined = undefined;
        if (route.lastUpdated < now - HEARTBEAT_TIMEOUT_MILLIS) cause = "dead";
        if (
          route.staleInDays !== undefined &&
          route.lastAccessed < now - route.staleInDays * DAY_IN_MILLIS
        )
          cause = "unused";

        if (cause) {
          const reason =
            cause === "dead"
              ? `Last updated: ${new Date(route.lastUpdated).toISOString()}`
              : `Last accessed: ${new Date(route.lastAccessed).toISOString()}`;
          logger.log(
            `Deleting ${cause} route: ${hostname} -> ${route.target} (${reason})`
          );
          delete this.#routes[hostname];
          await this.#db.routes.delete(hostname);
          onRouteStale(hostname);
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

  async set(hostname: string, target: string, staleInDays: number | undefined) {
    this.#logger.log(`Setting route: ${hostname} -> ${target}`);
    const now = Date.now();
    this.#routes[hostname] = {
      target,
      lastUpdated: now,
      lastAccessed: this.#routes[hostname]?.lastAccessed ?? now,
      lastAccessedDirty: false,
      added: new Date(now).toISOString(),
      hostname,
      staleInDays,
    };
    await this.#db.routes.set(hostname, target, staleInDays);
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
