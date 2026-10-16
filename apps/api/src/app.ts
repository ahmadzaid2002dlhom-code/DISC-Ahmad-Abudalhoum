import express from 'express';

export const app = express();
app.disable('x-powered-by');

// Liveness only. Database connectivity is verified separately with db:check.
app.get('/api/health', (_request, response) => {
  response.set('Cache-Control', 'no-store').json({ status: 'ok', service: 'disc-api' });
});

app.use((_request, response) => {
  response.status(404).json({ error: 'Not found' });
});
