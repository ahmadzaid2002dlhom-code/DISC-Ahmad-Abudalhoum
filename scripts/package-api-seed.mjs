import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { ASSESSMENT_VERSION, validateAssessmentSeed } from '../apps/api/dist/domain/scoring.js';
import { SEED_SHA256 } from '../apps/api/dist/data/assessment.js';

const source = new URL('../data/disc-assessment-seed.json', import.meta.url);
const bytes = readFileSync(source);
if (createHash('sha256').update(bytes).digest('hex') !== SEED_SHA256) {
  throw new Error('Private assessment seed fingerprint mismatch');
}
validateAssessmentSeed(JSON.parse(bytes.toString('utf8')));
const destination = new URL('../apps/api/dist/data/', import.meta.url);
mkdirSync(destination, { recursive: true });
copyFileSync(source, new URL('disc-assessment-seed.json', destination));
console.log(`Packaged private API seed: ${ASSESSMENT_VERSION}`);
