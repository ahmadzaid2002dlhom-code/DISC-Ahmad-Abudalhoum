import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import type { AssessmentSeed, AssessmentScores } from '../../src/domain/scoring.ts';

const temporaryFolders: string[] = [];
const built = new URL('../../dist/', import.meta.url);

function isolatedArtifact(withSeed = true): string {
  const root = mkdtempSync(join(tmpdir(), 'disc-phase2-'));
  temporaryFolders.push(root);
  mkdirSync(join(root, 'domain'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  for (const file of ['domain/scoring.js', 'data/assessment.js']) {
    copyFileSync(new URL(file, built), join(root, file));
  }
  if (withSeed) copyFileSync(new URL('data/disc-assessment-seed.json', built), join(root, 'data/disc-assessment-seed.json'));
  return root;
}

async function loadArtifact(root: string) {
  const loader = await import(pathToFileURL(join(root, 'data/assessment.js')).href) as {
    loadAssessmentSeed: (version?: string) => AssessmentSeed;
  };
  const scorer = await import(pathToFileURL(join(root, 'domain/scoring.js')).href) as {
    scoreAssessment: (source: unknown, answers: unknown) => AssessmentScores;
  };
  return { ...loader, ...scorer };
}

after(() => {
  for (const folder of temporaryFolders) {
    // Resolve and bound every recursive cleanup to the explicitly created temp root.
    const target = realpathSync(folder);
    assert.equal(dirname(target), realpathSync(tmpdir()));
    assert.ok(basename(target).startsWith('disc-phase2-'));
    rmSync(target, { recursive: true, force: true });
  }
});

test('isolated compiled API loads packaged private data and scores SINGLE/TIED results', async () => {
  const artifact = isolatedArtifact();
  const { loadAssessmentSeed, scoreAssessment } = await loadArtifact(artifact);
  const seed = loadAssessmentSeed();
  const answers = seed.groups.map(group => ({
    groupId: group.id,
    rankedWordIds: ['D', 'I', 'S', 'C'].map(d => group.words.find(word => word.dimension === d)!.id),
  }));
  const single = scoreAssessment(seed, answers);
  assert.deepEqual(single.scores, { D: 56, I: 42, S: 28, C: 14 });
  assert.equal(single.profileCode, 'DI');
  const tiedAnswers = answers.map((answer, index) => ({
    ...answer, rankedWordIds: index < 7 ? answer.rankedWordIds
      : [answer.rankedWordIds[1]!, answer.rankedWordIds[0]!, ...answer.rankedWordIds.slice(2)],
  }));
  const tied = scoreAssessment(seed, tiedAnswers);
  assert.equal(tied.profileStatus, 'TIED');
  assert.equal(tied.profileCode, null);
  assert.deepEqual(tied.candidateProfileCodes, ['DI', 'ID']);
  assert.deepEqual(tied.candidateProfiles.map(profile => profile.descriptionAr), ['المقنع', 'الملهم']);
  assert.throws(() => loadAssessmentSeed('unavailable-version'), /version is not available/);
});

test('compiled loader fails when its packaged seed is missing; no source fallback', async () => {
  const { loadAssessmentSeed } = await loadArtifact(isolatedArtifact(false));
  assert.throws(() => loadAssessmentSeed(), { code: 'ENOENT' });
});

test('compiled loader rejects changed private seed bytes before using their content', async () => {
  const root = isolatedArtifact();
  const path = join(root, 'data/disc-assessment-seed.json');
  writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('\n')]));
  const { loadAssessmentSeed } = await loadArtifact(root);
  assert.throws(() => loadAssessmentSeed(), /seed fingerprint mismatch/);
});

test('host build packages only the fingerprint-validated secret when the source checkout has no seed', () => {
  const root = mkdtempSync(join(tmpdir(), 'disc-phase2-'));
  temporaryFolders.push(root);
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'apps/api/dist/domain'), { recursive: true });
  mkdirSync(join(root, 'apps/api/dist/data'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  copyFileSync(new URL('../../../../scripts/package-api-seed.mjs', import.meta.url), join(root, 'scripts/package-api-seed.mjs'));
  for (const file of ['domain/scoring.js', 'data/assessment.js']) {
    copyFileSync(new URL(file, built), join(root, 'apps/api/dist', file));
  }
  const bytes = readFileSync(new URL('data/disc-assessment-seed.json', built));
  const run = (secret: string) => spawnSync(process.execPath, ['scripts/package-api-seed.mjs'], {
    cwd: root, env: { ...process.env, PRIVATE_SEED_BASE64: secret }, encoding: 'utf8', windowsHide: true,
  });
  const valid = run(bytes.toString('base64'));
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(readFileSync(join(root, 'apps/api/dist/data/disc-assessment-seed.json')), bytes);
  assert.equal(valid.stdout.includes(bytes.toString('base64')), false);
  const corrupt = run(Buffer.concat([bytes, Buffer.from('\n')]).toString('base64'));
  assert.notEqual(corrupt.status, 0);
  assert.match(corrupt.stderr, /fingerprint mismatch/);
});
