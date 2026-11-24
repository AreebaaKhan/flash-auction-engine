import { randomBytes } from 'node:crypto';

export function integer(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid numeric configuration: ${value}`);
  return n;
}
export function config(overrides = {}) {
  const secret = process.env.JWT_SECRET || randomBytes(48).toString('hex');
  if (secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
  return {
    host: process.env.HOST || '127.0.0.1', port: integer(process.env.PORT, 3000, 0, 65535),
    dbPath: process.env.DB_PATH || './data/auction.db', secret,
    maxConnections: integer(process.env.MAX_CONNECTIONS, 3000, 1),
    maxConnectionsPerIp: integer(process.env.MAX_CONNECTIONS_PER_IP, 2500, 1),
    userCapacity: integer(process.env.USER_RATE_CAPACITY, 15, 1),
    userRefill: integer(process.env.USER_RATE_REFILL, 5, 1),
    ipCapacity: integer(process.env.IP_RATE_CAPACITY, 1000, 1),
    ipRefill: integer(process.env.IP_RATE_REFILL, 500, 1),
    antiWindowMs: integer(process.env.ANTI_SNIPE_WINDOW_MS, 10000),
    antiExtensionMs: integer(process.env.ANTI_SNIPE_EXTENSION_MS, 10000),
    antiMax: integer(process.env.ANTI_SNIPE_MAX, 5, 0, 20),
    maxBuffer: 256 * 1024, broadcastMs: 75, heartbeatMs: 15000, ...overrides
  };
}
