import { createApp } from './app.ts';
import { getSecurityConfig, getServerAddress } from './env.ts';
import { createDatabaseClient } from './db/client.ts';

const { port, host } = getServerAddress();
const config = getSecurityConfig();
const db = createDatabaseClient();
const app = createApp({ db, config });
const server = app.listen(port, host, () => {
  console.log(`DISC API listening on ${host}:${port}`);
});

server.on('error', () => {
  console.error('DISC API could not listen. Check API_HOST and PORT/API_PORT.');
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(async error => {
      if (error) process.exitCode = 1;
      await db.$disconnect();
    });
    server.closeIdleConnections();
  });
}
