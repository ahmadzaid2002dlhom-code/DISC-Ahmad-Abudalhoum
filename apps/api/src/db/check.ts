import { createDatabaseClient } from './client.ts';

async function check(): Promise<void> {
  const db = createDatabaseClient();
  try {
    const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1::integer AS ok`;
    if (rows[0]?.ok !== 1) throw new Error('Unexpected database response.');
    console.log('PostgreSQL connection verified through Prisma (SELECT 1).');
  } finally {
    await db.$disconnect();
  }
}

check().catch(() => {
  console.error('Database check failed. Configure DATABASE_URL in the root .env.local and verify PostgreSQL access.');
  process.exitCode = 1;
});
