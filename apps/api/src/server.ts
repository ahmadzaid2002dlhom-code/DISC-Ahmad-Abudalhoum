import { app } from './app.ts';
import { getServerAddress } from './env.ts';

const { port, host } = getServerAddress();
const server = app.listen(port, host, () => {
  console.log(`DISC API listening on ${host}:${port}`);
});

server.on('error', () => {
  console.error('DISC API could not listen. Check API_HOST and PORT/API_PORT.');
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(error => {
      if (error) process.exitCode = 1;
    });
    server.closeIdleConnections();
  });
}
