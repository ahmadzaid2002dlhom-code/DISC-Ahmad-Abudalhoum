import { seedStaff } from '../auth/seed.ts';
import { createDatabaseClient } from './client.ts';

const db = createDatabaseClient();
try {
  await seedStaff(db);
  console.log('Separate FACILITATOR and MANAGER accounts are seeded. Existing passwords were preserved.');
} catch {
  console.error('Staff seeding failed. Check database access and the distinct staff seed environment values.');
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
