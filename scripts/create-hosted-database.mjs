import './load-env.mjs';
import pg from 'pg';

// Explicit, one-time provisioning of this app's new logical database only.
// The existing database is used for CREATE DATABASE, never migrated or seeded.
const source = new URL(process.env.PROVISION_DATABASE_URL ?? '');
const target = new URL(process.env.DATABASE_URL ?? '');
if (!['postgres:', 'postgresql:'].includes(source.protocol) ||
    source.origin !== target.origin || source.host !== target.host ||
    source.username !== target.username || source.password !== target.password ||
    target.pathname !== '/disc_prototype_v12' || source.pathname === target.pathname) {
  throw new Error('Explicit matching PostgreSQL URLs and a separate disc_prototype_v12 target are required.');
}
const db = new pg.Client({ connectionString: source.href });
try {
  await db.connect();
  const existing = await db.query('SELECT 1 FROM pg_database WHERE datname=$1', ['disc_prototype_v12']);
  if (!existing.rowCount) await db.query('CREATE DATABASE disc_prototype_v12');
  console.log('Separate DISC logical database is available.');
} catch {
  console.error('DISC database provisioning failed; check internal connectivity and CREATE DATABASE permission.');
  process.exitCode = 1;
} finally {
  await db.end();
}
