import Cloudflare from "cloudflare";
import type Logger from "./Logger.ts";
import IpAddressProvider from "./IpAddressProvider.ts";
import config from "../config.ts";
import type { Zone } from "cloudflare/resources/zones/zones.mjs";
import type { SystemLogger } from "./Logger.ts";
import Database from "../db/Database.ts";
import map from "./fp/map.ts";

const hostnameToDnsEntryName = (hostname: string, zoneName: string) =>
  hostname === zoneName
    ? "@"
    : hostname.substring(0, hostname.length - (zoneName.length + 1));

class DnsManager {
  static async create({ logger, db }: { logger: Logger; db: Database }) {
    const systemLogger = logger.forSystem("dns-manager");
    const cloudflare = new Cloudflare({ apiToken: config.cloudflareApiToken });
    const [ipProvider, zone] = await Promise.all([
      IpAddressProvider.create(logger),
      cloudflare.zones.list().then(async (zones) => {
        const [zone, ...moreZones] = zones.result;
        if (moreZones.length > 0)
          throw new Error(
            `More than one zone found for token. This is not supported yet.\n${zones.result.map(
              (z) => ` - ${z.id}: ${z.name}`
            )}`
          );
        return zone;
      }),
    ]);

    systemLogger.log(`Using cloudflare zone id ${zone.id} for ${zone.name}`);

    return new DnsManager(systemLogger, cloudflare, ipProvider, zone, db);
  }

  #logger;
  #cloudflare;
  #zoneId;
  #ipProvider;
  #db;

  readonly zoneName;

  private constructor(
    logger: SystemLogger<"dns-manager">,
    cloudflare: Cloudflare,
    ipProvider: IpAddressProvider,
    zone: Zone,
    db: Database
  ) {
    this.#logger = logger;
    this.#cloudflare = cloudflare;
    this.#ipProvider = ipProvider;
    this.#zoneId = zone.id;
    this.zoneName = zone.name;
    this.#db = db;

    ipProvider.onIpChange(async (newIp) => {
      const records = await this.#getManagedDnsRecords();
      for (const record of records.filter((r) => r.content !== newIp)) {
        if (!record.id) {
          this.#logger.error(`No id for DNS record`, record);
          continue;
        }
        if (record.content === newIp) continue; // we might get the same IP on init.

        this.#logger.log(
          `Updating IP for ${record.name} from ${record.content} to ${newIp}`
        );
        await this.#cloudflare.dns.records.update(record.id, {
          ...record,
          zone_id: this.#zoneId,
          content: newIp,
          comment: "Updated by Hobbyproxy on " + new Date().toISOString(),
        });
      }
    });
  }

  async #getManagedDnsRecords() {
    const entryNames = await this.#db.routes
      .getAll()
      .then(map((r) => r.hostname));
    const records: Cloudflare.DNS.Records.ARecord[] = [];

    for await (const record of this.#cloudflare.dns.records.list({
      zone_id: this.#zoneId,
      type: "A",
    })) {
      if (!entryNames.includes(record.name) || record.type !== "A") continue;
      records.push(record);
    }

    return records;
  }

  async upsertDnsEntry(hostname: string) {
    const entry:
      | Cloudflare.DNS.Records.RecordCreateParams
      | Cloudflare.DNS.Records.RecordUpdateParams = {
      name: hostnameToDnsEntryName(hostname, this.zoneName),
      content: this.#ipProvider.getLastKnownIp(),
      comment: "Updated by Hobbyproxy on " + new Date().toISOString(),
      zone_id: this.#zoneId,
      type: "A",
    };

    const records = await this.#getManagedDnsRecords();
    const matchingRecord = records.find((r) => r.name === hostname);
    if (matchingRecord && matchingRecord.id) {
      if (matchingRecord.content !== entry.content) {
        const updatedEntry = await this.#cloudflare.dns.records.update(
          matchingRecord.id,
          entry
        );
        this.#logger.log("Updated existing DNS record", updatedEntry);
        return true;
      } else {
        this.#logger.log("Skipped DNS record update, content matches already");
        return false;
      }
    } else {
      this.#logger.log("Creating new DNS record");
      await this.#cloudflare.dns.records.create(entry);
      return true;
    }
  }

  async delete(hostname: string) {
    this.#logger.log(`Deleting DNS record for ${hostname}`);

    const matches = await this.#cloudflare.dns.records.list({
      zone_id: this.#zoneId,
      name: hostname,
    });
    const dnsEntry = matches.result.at(0);
    if (!dnsEntry?.id) {
      await this.#logger.error(
        `Could not find a DNS entry for ${hostname} in zone ${this.#zoneId} (${
          this.zoneName
        })`
      );
      return;
    }

    await this.#cloudflare.dns.records.delete(dnsEntry.id, {
      zone_id: this.#zoneId,
    });
  }
}

export default DnsManager;
