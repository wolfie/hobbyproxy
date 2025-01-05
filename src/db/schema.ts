import type { Insertable, Selectable, Updateable } from "kysely";

export interface Database {
  routes: RoutesTable;
  logs: LogsTable;
  certificates: CertificatesTable;
}

export interface RoutesTable {
  hostname: string;
  target: string;
  added: string;
  lastAccessed: number;
  lastUpdated: number;
}

export type Route = Selectable<RoutesTable>;
export type NewRoute = Insertable<RoutesTable>;
export type RouteUpdate = Updateable<RoutesTable>;

export interface LogsTable {
  timestamp: number;
  level: string;
  system: string;
  log: string;
}

export type Log = Selectable<LogsTable>;
export type NewLog = Insertable<LogsTable>;

export interface CertificatesTable {
  hostname: string;
  updatedAt: string;
  expiresOn: string;
}

export type Certificate = Selectable<CertificatesTable>;
export type NewCertificate = Insertable<CertificatesTable>;
export type CertificateUpdate = Updateable<CertificatesTable>;
