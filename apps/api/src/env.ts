import '../../../scripts/load-env.mjs';

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
