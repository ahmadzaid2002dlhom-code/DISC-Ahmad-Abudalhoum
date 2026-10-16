import type { RequestHandler } from 'express';
import type { PrismaClient, StaffRole } from '../generated/prisma/client.ts';
import { HttpError } from './errors.ts';

export function requireStaff(db: PrismaClient, role?: StaffRole): RequestHandler {
  return async (request, response, next) => {
    const principal = request.session.principal;
    if (!principal) throw new HttpError(401, 'Authentication required.');
    if (principal.type !== 'STAFF') throw new HttpError(403, 'Staff access required.');
    const user = await db.staffUser.findUnique({ where: { id: principal.staffUserId } });
    if (!user) throw new HttpError(401, 'Session principal no longer exists.');
    if (role && user.role !== role) throw new HttpError(403, 'Manager access required.');
    response.locals.staff = { id: user.id, email: user.email, role: user.role };
    next();
  };
}

export function requireParticipant(db: PrismaClient): RequestHandler {
  return async (request, response, next) => {
    const principal = request.session.principal;
    if (!principal) throw new HttpError(401, 'Authentication required.');
    if (principal.type !== 'PARTICIPANT') throw new HttpError(403, 'Participant access required.');
    const participant = await db.participant.findUnique({ where: { id: principal.participantId } });
    if (!participant) throw new HttpError(401, 'Session principal no longer exists.');
    response.locals.participant = participant;
    next();
  };
}
