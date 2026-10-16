import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

// Node preserves existing process variables. Load local overrides before defaults.
// Resolve against this file, so all workspaces behave the same from any cwd.
for (const name of ['.env.local', '.env']) {
  const path = new URL(`../${name}`, import.meta.url);
  if (existsSync(path)) loadEnvFile(path);
}
