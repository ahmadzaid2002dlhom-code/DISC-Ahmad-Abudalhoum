import type { PrismaClient, StaffRole } from '../generated/prisma/client.ts';
import { hashPassword } from './password.ts';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function seedStaff(db: PrismaClient, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const users = (['FACILITATOR', 'MANAGER'] as const).map(role => {
    const email = env[`${role}_SEED_EMAIL`]?.trim().toLowerCase();
    const password = env[`${role}_SEED_PASSWORD`];
    if (!email || !emailPattern.test(email) || !password || password.length < 12 || password.length > 256 ||
        /REPLACE|changeme/i.test(password)) throw new Error(`Set valid ${role} seed email and a password of 12–256 characters.`);
    return { email, password, role: role as StaffRole };
  });
  if (users[0]!.email === users[1]!.email) throw new Error('Staff seed emails must be distinct.');
  const hashes = await Promise.all(users.map(u => hashPassword(u.password)));
  await db.$transaction(async tx => {
    for (const [index, user] of users.entries()) {
      const existing = await tx.staffUser.findUnique({ where: { email: user.email } });
      if (existing && existing.role !== user.role) throw new Error('Existing seed account has a different role.');
      // Explicit seeding is idempotent and never silently resets an existing password.
      if (!existing) await tx.staffUser.create({ data: {
        email: user.email, role: user.role, passwordHash: hashes[index]!,
      } });
    }
  });
}
