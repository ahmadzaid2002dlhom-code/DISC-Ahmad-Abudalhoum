import { createHash } from 'node:crypto';
import session, { type SessionData } from 'express-session';
import type { Request } from 'express';
import type { PrismaClient, Prisma } from '../generated/prisma/client.ts';

export type Principal = { type: 'STAFF'; staffUserId: string } |
  { type: 'PARTICIPANT'; participantId: string };

declare module 'express-session' {
  interface SessionData { principal?: Principal }
}

const digest = (sid: string): string => createHash('sha256').update(sid).digest('hex');
type Done = (error?: unknown) => void;

/** No in-memory fallback: every saved session and expiry lives in PostgreSQL. */
export class PostgresSessionStore extends session.Store {
  private readonly db: PrismaClient;
  private readonly ttlMs: number;
  constructor(db: PrismaClient, ttlMs: number) {
    super();
    this.db = db;
    this.ttlMs = ttlMs;
  }

  override get(sid: string, callback: (error: unknown, value?: SessionData | null) => void): void {
    void this.db.session.findUnique({ where: { id: digest(sid) } }).then(async row => {
      if (!row) { callback(null, null); return; }
      if (row.expiresAt.getTime() <= Date.now()) {
        await this.db.session.deleteMany({ where: { id: row.id, expiresAt: { lte: new Date() } } });
        callback(null, null);
        return;
      }
      callback(null, row.data as unknown as SessionData);
    }).catch(callback);
  }

  override set(sid: string, value: SessionData, callback: Done = () => {}): void {
    const expiresAt = value.cookie.expires ? new Date(value.cookie.expires) : new Date(Date.now() + this.ttlMs);
    const data = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
    // Opportunistic cleanup is bounded to expired rows, never active sessions.
    void this.db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } })
      .then(() => this.db.session.upsert({ where: { id: digest(sid) },
        create: { id: digest(sid), data, expiresAt }, update: { data, expiresAt } }))
      .then(() => callback()).catch(callback);
  }

  override destroy(sid: string, callback: Done = () => {}): void {
    void this.db.session.deleteMany({ where: { id: digest(sid) } }).then(() => callback()).catch(callback);
  }

  // Absolute lifetime: reads do not renew a session or race with revocation/expiry.
}

export async function switchPrincipal(request: Request, principal: Principal): Promise<void> {
  await new Promise<void>((resolve, reject) => request.session.regenerate(error => error ? reject(error) : resolve()));
  request.session.principal = principal;
  // A redirect/navigation target is returned only after durable persistence succeeds.
  try {
    await new Promise<void>((resolve, reject) => request.session.save(error => error ? reject(error) : resolve()));
  } catch (error) {
    // Do not let Express auto-save or issue a cookie for a failed authentication save.
    await new Promise<void>(resolve => request.session.destroy(() => resolve()));
    throw error;
  }
}
