import { createHash, randomBytes } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import type { PrismaClient, Participant } from './generated/prisma/client.ts';
import type { SecurityConfig } from './env.ts';
import { PostgresSessionStore, switchPrincipal } from './auth/session.ts';
import { hashPassword, verifyPassword } from './auth/password.ts';
import { loadAssessmentSeed } from './data/assessment.ts';
import { HttpError, objectBody, requiredText, emailAddress } from './http/errors.ts';
import { requireParticipant, requireStaff } from './http/access.ts';
import { resultDto } from './http/reports.ts';
import { participantDto } from './http/participants.ts';
import { readAssessment, saveAnswer, submitAssessment } from './services/assessment.ts';
import { readCohort, readManagerSummary } from './services/cohort.ts';

export const inviteHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

function baseApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    next();
  });
  app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'disc-api' }));
  return app;
}

function notFound(app: express.Express): void {
  app.use((_request, response) => { response.status(404).json({ error: 'Not found' }); });
}

// Liveness app is independent of DB credentials; the runtime uses createApp below.
export const app = baseApp();
notFound(app);

export function createApp({ db, config }: { db: PrismaClient; config: SecurityConfig }) {
  const app = baseApp();
  app.set('trust proxy', config.trustedProxies.length ? config.trustedProxies : false);
  const cookieName = config.production ? '__Host-disc.sid' : 'disc.sid';
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/' };
  app.use('/api', (request, _response, next) => {
    if (config.production && !request.secure) throw new HttpError(400, 'HTTPS is required.');
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (request.get('Origin') !== config.appOrigin) throw new HttpError(403, 'Invalid request origin.');
      if (!request.is('application/json')) throw new HttpError(415, 'Use application/json.');
    }
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use(session({
    name: cookieName, secret: config.sessionSecret,
    store: new PostgresSessionStore(db, config.sessionMaxAgeMs),
    resave: false, saveUninitialized: false, rolling: false,
    cookie: { ...cookieOptions, maxAge: config.sessionMaxAgeMs },
  }));
  // Unknown users still incur the same password derivation work.
  const dummyHash = hashPassword(randomBytes(32).toString('hex'));

  app.post('/api/auth/login', async (request, response) => {
    const body = objectBody(request.body, ['email', 'password']);
    const email = emailAddress(body.email);
    if (typeof body.password !== 'string' || !body.password || body.password.length > 256) throw new HttpError(400, 'Invalid password.');
    const user = await db.staffUser.findUnique({ where: { email } });
    const valid = await verifyPassword(body.password, user?.passwordHash ?? await dummyHash);
    if (!user || !valid) throw new HttpError(401, 'Invalid email or password.');
    await switchPrincipal(request, { type: 'STAFF', staffUserId: user.id });
    response.json({ principal: { type: 'STAFF', id: user.id, email: user.email, role: user.role }, redirectTo: '/login' });
  });

  app.post('/api/auth/logout', async (request, response) => {
    objectBody(request.body, []);
    await new Promise<void>((resolve, reject) => request.session.destroy(error => error ? reject(error) : resolve()));
    response.clearCookie(cookieName, cookieOptions).status(204).end();
  });

  app.get('/api/auth/me', async (request, response) => {
    const principal = request.session.principal;
    if (!principal) throw new HttpError(401, 'Authentication required.');
    if (principal.type === 'STAFF') {
      const user = await db.staffUser.findUnique({ where: { id: principal.staffUserId }, select: { id: true, email: true, role: true } });
      if (!user) throw new HttpError(401, 'Session principal no longer exists.');
      response.json({ principal: { type: 'STAFF', ...user } });
    } else {
      const participant = await db.participant.findUnique({ where: { id: principal.participantId }, select: { id: true, name: true, status: true } });
      if (!participant) throw new HttpError(401, 'Session principal no longer exists.');
      response.json({ principal: { type: 'PARTICIPANT', ...participant } });
    }
  });

  app.use('/api/participants', requireStaff(db));
  app.post('/api/participants', async (request, response) => {
    const body = objectBody(request.body, ['name', 'email']);
    const name = requiredText(body.name, 'name', 200);
    const email = body.email === undefined || body.email === null ? null : emailAddress(body.email);
    const token = randomBytes(32).toString('base64url');
    const seed = loadAssessmentSeed();
    const participant = await db.participant.create({ data: {
      name, email, inviteTokenHash: inviteHash(token), inviteExpiresAt: new Date(Date.now() + config.inviteLifetimeMs),
      assessmentVersion: seed.assessmentVersion, scoringPolicyVersion: seed.scoringPolicyVersion,
      profileTextPolicyVersion: seed.profileTextPolicyVersion,
    } });
    response.status(201).json({ participant: participantDto(participant), invitationUrl: `${config.appOrigin}/invite/${token}` });
  });
  app.get('/api/participants', async (_request, response) => {
    response.json({ participants: await readCohort(db) });
  });
  app.get('/api/participants/:id/report', async (request, response) => {
    if (!uuid.test(request.params.id as string)) throw new HttpError(404, 'Participant not found.');
    const participant = await db.participant.findUnique({ where: { id: request.params.id as string }, include: { result: true } });
    if (!participant) throw new HttpError(404, 'Participant not found.');
    if (participant.status !== 'COMPLETED' || !participant.result) throw new HttpError(409, 'Assessment is not completed.');
    response.json({ participant: participantDto(participant), result: resultDto(participant.result) });
  });

  app.post('/api/invitations/redeem', async (request, response) => {
    const body = objectBody(request.body, ['token']);
    if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw new HttpError(400, 'Invalid invitation token.');
    const tokenHash = inviteHash(body.token);
    const participant = await db.$transaction(async tx => {
      const rows = await tx.$queryRaw<Participant[]>`SELECT * FROM "Participant" WHERE "inviteTokenHash" = ${tokenHash} FOR UPDATE`;
      const found = rows[0];
      if (!found || found.inviteExpiresAt.getTime() <= Date.now()) throw new HttpError(400, 'Invalid or expired invitation.');
      // Completed participants read their old stored report without requiring a current seed.
      if (found.status !== 'COMPLETED') {
        try {
          const seed = loadAssessmentSeed(found.assessmentVersion);
          if (found.scoringPolicyVersion !== seed.scoringPolicyVersion || found.profileTextPolicyVersion !== seed.profileTextPolicyVersion) throw new Error();
        } catch { throw new HttpError(409, 'The pinned assessment version is not available.'); }
      }
      return found.status === 'INVITED' ? tx.participant.update({ where: { id: found.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } }) : found;
    });
    await switchPrincipal(request, { type: 'PARTICIPANT', participantId: participant.id });
    response.json({ redirectTo: participant.status === 'COMPLETED' ? '/result' : '/assessment' });
  });

  app.use('/api/assessment', requireParticipant(db));
  app.get('/api/assessment', async (_request, response) => {
    const { id } = response.locals.participant as Participant;
    response.json(await readAssessment(db, id));
  });
  app.put('/api/assessment/answers/:groupId', async (request, response) => {
    const body = objectBody(request.body, ['rankedWordIds']);
    const { id } = response.locals.participant as Participant;
    response.json({ answer: await saveAnswer(db, id, request.params.groupId as string, body.rankedWordIds) });
  });
  app.post('/api/assessment/submit', async (request, response) => {
    objectBody(request.body, []);
    const { id } = response.locals.participant as Participant;
    response.json({ result: await submitAssessment(db, id) });
  });
  app.get('/api/assessment/result', async (_request, response) => {
    const participant = response.locals.participant as Participant;
    const result = await db.result.findUnique({ where: { participantId: participant.id } });
    if (participant.status !== 'COMPLETED' || !result) throw new HttpError(409, 'Assessment is not completed.');
    response.json({ result: resultDto(result) });
  });
  app.use('/api/manager', requireStaff(db, 'MANAGER'));
  app.get('/api/manager/summary', async (_request, response) => {
    response.json(await readManagerSummary(db));
  });
  notFound(app);
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    void _next;
    if (error instanceof HttpError) { response.status(error.status).json({ error: error.message }); return; }
    const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
    if (status === 400 || status === 413) { response.status(status).json({ error: 'Invalid JSON request body.' }); return; }
    // Do not log request bodies, URLs, passwords, invite tokens or database errors.
    response.status(500).json({ error: 'Internal server error.' });
  };
  app.use(errors);
  return app;
}
