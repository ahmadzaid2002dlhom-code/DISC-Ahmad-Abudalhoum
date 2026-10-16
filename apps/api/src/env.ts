import '../../../scripts/load-env.mjs';
import { isIP } from 'node:net';

export function getServerAddress(): { port: number; host: string } {
  const rawPort = process.env.PORT ?? process.env.API_PORT ?? '4000';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT/API_PORT must be an integer from 1 to 65535.');
  }
  return { port, host: process.env.API_HOST ?? '127.0.0.1' };
}

export function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('Set DATABASE_URL in the root .env.local or process environment.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
  return value;
}

export type SecurityConfig = {
  appOrigin: string;
  sessionSecret: string;
  production: boolean;
  trustedProxies: string[];
  sessionMaxAgeMs: number;
  inviteLifetimeMs: number;
};

export function getSecurityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  const production = env.NODE_ENV === 'production';
  const url = new URL(env.PUBLIC_APP_URL ?? 'http://localhost:3000');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || (production && url.protocol !== 'https:')) {
    throw new Error('PUBLIC_APP_URL must be an origin; production requires HTTPS.');
  }
  const sessionSecret = env.SESSION_SECRET ?? '';
  if (Buffer.byteLength(sessionSecret) < 32 || /REPLACE|example|changeme/i.test(sessionSecret)) {
    throw new Error('SESSION_SECRET must contain at least 32 random bytes of text.');
  }
  const trustedProxies = (env.TRUSTED_PROXY_CIDRS ?? '').split(',').map(x => x.trim()).filter(Boolean);
  // Trust addresses/networks, never a hop count or an unconditional boolean.
  if (trustedProxies.some(value => {
    const parts = value.split('/');
    const version = isIP(parts[0]!);
    if (!version || parts.length > 2) return true;
    const mask = parts[1];
    return mask !== undefined && (!/^\d{1,3}$/.test(mask) || Number(mask) < 1 || Number(mask) > (version === 4 ? 32 : 128));
  })) {
    throw new Error('TRUSTED_PROXY_CIDRS must be explicit proxy IP addresses or CIDRs.');
  }
  if (production && (!trustedProxies.length || env.PROXY_CONFIGURATION_VERIFIED !== 'true')) {
    throw new Error('Production requires verified proxy CIDRs and PROXY_CONFIGURATION_VERIFIED=true.');
  }
  return {
    appOrigin: url.origin, sessionSecret, production, trustedProxies,
    sessionMaxAgeMs: 8 * 60 * 60 * 1000,
    inviteLifetimeMs: 7 * 24 * 60 * 60 * 1000,
  };
}
