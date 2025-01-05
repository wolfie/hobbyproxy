import type Logger from "./Logger.ts";
import type { SystemLogger } from "./Logger.ts";

class IpAddressProvider {
  #latestIp: string;
  #ipChangeListeners: ((ip: string) => void)[] = [];

  static async create(logger: Logger) {
    const systemLogger = logger.forSystem("ip-address-provider");
    const ip = await this.#getCurrentExternalIp();
    if (!ip) throw new Error("Failed to get initial IP");

    systemLogger.log("Got initial IP: " + ip);
    return new IpAddressProvider(ip, systemLogger);
  }

  static #getCurrentExternalIp = () =>
    fetch("https://api.ipify.org")
      .then((response) => {
        if (response.status === 200) return response.text();
        else return undefined;
      })
      .catch((e) => {
        if (e instanceof Error && "code" in e && e.code === "ENOTFOUND")
          return undefined;
        throw e;
      });

  private constructor(
    initialIp: string,
    logger: SystemLogger<"ip-address-provider">
  ) {
    this.#latestIp = initialIp;
    setInterval(async () => {
      const ip = await IpAddressProvider.#getCurrentExternalIp();
      if (!ip) {
        logger.log("Failed to get current IP");
      } else if (ip !== this.#latestIp) {
        logger.log(`Ip changed from ${this.#latestIp} to ${ip}`);
        this.#latestIp = ip;
        this.#ipChangeListeners.forEach((l) => l(ip));
      }
    }, 60_000);
  }

  getLastKnownIp() {
    return this.#latestIp;
  }

  /** Will be called on initial add */
  onIpChange(listener: (newIp: string) => void) {
    this.#ipChangeListeners.push(listener);
    listener(this.#latestIp);
    return {
      remove: () => {
        this.#ipChangeListeners = this.#ipChangeListeners.filter(
          (x) => x !== listener
        );
      },
    };
  }
}

export default IpAddressProvider;
