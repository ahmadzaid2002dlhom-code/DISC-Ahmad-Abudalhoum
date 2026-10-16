import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSESSMENT_VERSION, AssessmentValidationError, validateAssessmentSeed,
  type AssessmentSeed,
} from '../domain/scoring.ts';

// Pins the original private JSON bytes, including all 56 opaque IDs and raw text.
export const SEED_SHA256 = '5c6cec273ef5282e3cf926ba4b72032c45407e149d197497bcc3e4d6d5895e37';

function freezeDeep(value: object): void {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) freezeDeep(child);
  }
  Object.freeze(value);
}

/** Native TypeScript uses the original source; compiled JS uses its packaged copy. */
export function loadAssessmentSeed(version: string = ASSESSMENT_VERSION): AssessmentSeed {
  if (version !== ASSESSMENT_VERSION) {
    throw new AssessmentValidationError('Assessment version is not available');
  }
  const seedUrl = extname(fileURLToPath(import.meta.url)) === '.ts'
    ? new URL('../../../../data/disc-assessment-seed.json', import.meta.url)
    : new URL('./disc-assessment-seed.json', import.meta.url);
  const bytes = readFileSync(seedUrl);
  if (createHash('sha256').update(bytes).digest('hex') !== SEED_SHA256) {
    throw new AssessmentValidationError('Private assessment seed fingerprint mismatch');
  }
  const seed: unknown = JSON.parse(bytes.toString('utf8'));
  validateAssessmentSeed(seed);
  freezeDeep(seed);
  return seed;
}
