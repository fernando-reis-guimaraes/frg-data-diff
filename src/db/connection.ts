import { Pool, type PoolConfig } from "pg";
import {
  resolveBooleanValue,
  resolvePortValue,
  resolveStringValue,
} from "../shared/env-values";

export const DEFAULT_CONNECTION_TIMEOUT_MS = 30000;

export interface PgConnectionParams {
  host: string;
  port: number | string;
  database: string;
  user: string;
  password: string;
  ssl: boolean | string;
}

export interface ResolvedPgConnectionParams {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export function resolveConnectionParams(
  params: PgConnectionParams,
  labels: {
    host: string;
    port: string;
    database: string;
    user: string;
    password: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): ResolvedPgConnectionParams {
  return {
    host: resolveStringValue(params.host, labels.host, env),
    port: resolvePortValue(params.port, labels.port, env),
    database: resolveStringValue(params.database, labels.database, env),
    user: resolveStringValue(params.user, labels.user, env),
    password: resolveStringValue(params.password, labels.password, env),
    ssl: resolveBooleanValue(params.ssl, `${labels.host} ssl`, env),
  };
}

export function createPool(params: ResolvedPgConnectionParams): Pool {
  return new Pool(buildPoolConfig(params));
}

export function buildPoolConfig(
  params: ResolvedPgConnectionParams,
): PoolConfig {
  return {
    host: params.host,
    port: params.port,
    database: params.database,
    user: params.user,
    password: params.password,
    ssl: params.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
  };
}
