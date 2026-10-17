import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ASSESSMENT_VERSION, validateAssessmentSeed } from '../apps/api/dist/domain/scoring.js';
import { SEED_SHA256 } from '../apps/api/dist/data/assessment.js';

const source = new URL('../data/disc-assessment-seed.json', import.meta.url);
// Hosts can supply the unchanged private input as a backend-only build secret.
// It is never uploaded with the frontend or published in the Git repository.
const encoded = process.env.PRIVATE_SEED_BASE64;
const bytes = existsSync(source) ? readFileSync(source) : encoded
  ? Buffer.from(encoded, 'base64') : readFileSync(source);
if (createHash('sha256').update(bytes).digest('hex') !== SEED_SHA256) {
  throw new Error('Private assessment seed fingerprint mismatch');
}
validateAssessmentSeed(JSON.parse(bytes.toString('utf8')));
const destination = new URL('../apps/api/dist/data/', import.meta.url);
mkdirSync(destination, { recursive: true });
writeFileSync(new URL('disc-assessment-seed.json', destination), bytes);
console.log(`Packaged private API seed: ${ASSESSMENT_VERSION}`);
