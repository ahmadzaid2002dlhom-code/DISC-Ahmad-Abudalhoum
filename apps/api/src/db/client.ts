import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import { requireDatabaseUrl } from '../env.ts';

export function createDatabaseClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: requireDatabaseUrl(),
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    max: 5,
  });
  return new PrismaClient({ adapter });
}
