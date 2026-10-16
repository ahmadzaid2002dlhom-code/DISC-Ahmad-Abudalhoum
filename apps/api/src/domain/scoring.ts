/**
 * Server-only scoring domain, adapted from the preserved reference/scoring.ts.
 * DB locking, confirmed-answer gating, authentication and persistence belong to
 * the API service; a pure scorer cannot provide those guarantees by itself.
 */
export const DIMENSIONS = ['D', 'I', 'S', 'C'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const PROFILE_CODES = [
  'DI', 'DS', 'DC', 'ID', 'IS', 'IC',
  'SD', 'SI', 'SC', 'CD', 'CI', 'CS',
] as const;
export type ProfileCode = (typeof PROFILE_CODES)[number];
export const ASSESSMENT_VERSION = 'disc-2024-english-arabic-v1.2';
export const SCORING_POLICY_VERSION = 'score-ties-visible-v2';
export const PROFILE_TEXT_POLICY_VERSION = 'excel-slogan-as-description-v1';
export const SOURCE_SHA256 = '57b23a2a2b8679ba669e3657d282c053bb26ec6a7da5965388adf6f89dcdaf60';
const POINTS = [4, 3, 2, 1] as const;
const GROUP_COUNT = 14;
const SOURCE_ROWS = [2, 4, 6, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29] as const;
const SOURCE_COLUMNS = { C: ['A', 'B'], D: ['C', 'D'], S: ['E', 'F'], I: ['G', 'H'] } as const;
const PROFILE_ROWS: Record<ProfileCode, number> = {
  CD: 2, CI: 3, CS: 5, DI: 7, DS: 9, DC: 11,
  ID: 13, IC: 15, IS: 17, SC: 19, SD: 21, SI: 23,
};

export type Word = {
  readonly id: string;
  readonly textEn: string;
  readonly textAr: string;
  readonly dimension: Dimension;
  readonly source: { readonly enCells: readonly string[]; readonly arCell: string };
};

export type Group = {
  readonly id: string;
  readonly sequence: number;
  readonly sourceRow: number;
  readonly words: readonly Word[];
};

export type Profile = {
  readonly code: ProfileCode;
  readonly sourceRow: number;
  readonly labelAr: string;
  readonly nameAr: string;
  readonly rawP: string | null;
  readonly rawQ: string | null;
  readonly rawR: string | null;
  readonly descriptionEn: string | null;
  readonly descriptionAr: string;
};

export type AssessmentSeed = {
  readonly assessmentVersion: string;
  readonly scoringPolicyVersion: typeof SCORING_POLICY_VERSION;
  readonly profileTextPolicyVersion: typeof PROFILE_TEXT_POLICY_VERSION;
  readonly sourceWorkbook: string;
  readonly sourceSheet: string;
  readonly sourceSha256: string;
  readonly weights: readonly number[];
  readonly groups: readonly Group[];
  readonly profiles: readonly Profile[];
  readonly contentStatus: string;
};

export type Answer = { readonly groupId: string; readonly rankedWordIds: readonly string[] };
export type ScoreTie = { score: number; dimensions: Dimension[] };
export type ScoreRank = ScoreTie & { rank: number };
export type AssessmentScores = {
  assessmentVersion: string;
  scoringPolicyVersion: typeof SCORING_POLICY_VERSION;
  profileTextPolicyVersion: typeof PROFILE_TEXT_POLICY_VERSION;
  scores: Record<Dimension, number>;
  scoreRanking: ScoreRank[];
  totalPoints: number;
  hasScoreTie: boolean;
  tiedScoreGroups: ScoreTie[];
  profileStatus: 'SINGLE' | 'TIED';
  profileCode: ProfileCode | null;
  profile: Profile | null;
  candidateProfileCodes: ProfileCode[];
  candidateProfiles: Profile[];
};

export type PublicAssessment = {
  assessmentVersion: string;
  groups: {
    id: string;
    sequence: number;
    words: { id: string; textEn: string; textAr: string }[];
  }[];
};

export class AssessmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssessmentValidationError';
  }
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssessmentValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || isText(value);
}

function isDimension(value: unknown): value is Dimension {
  return DIMENSIONS.some(dimension => dimension === value);
}

function isProfileCode(value: unknown): value is ProfileCode {
  return PROFILE_CODES.some(code => code === value);
}

/** Validate the whole private source, including every possible profile lookup. */
export function validateAssessmentSeed(value: unknown): asserts value is AssessmentSeed {
  requireCondition(isRecord(value), 'Invalid assessment source');
  for (const field of ['assessmentVersion', 'sourceWorkbook', 'sourceSheet', 'contentStatus']) {
    requireCondition(isText(value[field]), `Missing source field: ${field}`);
  }
  requireCondition(value.assessmentVersion === ASSESSMENT_VERSION, 'Unsupported assessment version');
  requireCondition(value.sourceWorkbook === 'New DISC online(2).xlsx', 'Unexpected source workbook');
  requireCondition(value.sourceSheet === '2024 English - arabic', 'Unexpected source sheet');
  requireCondition(
    typeof value.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sourceSha256),
    'Invalid workbook SHA-256',
  );
  requireCondition(value.sourceSha256 === SOURCE_SHA256, 'Unexpected workbook SHA-256');
  requireCondition(value.scoringPolicyVersion === SCORING_POLICY_VERSION, 'Unsupported scoring policy');
  requireCondition(value.profileTextPolicyVersion === PROFILE_TEXT_POLICY_VERSION, 'Unsupported profile text policy');
  const weights = value.weights;
  requireCondition(
    Array.isArray(weights) && weights.length === 4 &&
      POINTS.every((points, index) => weights[index] === points),
    'Expected rank weights 4,3,2,1',
  );
  requireCondition(Array.isArray(value.groups) && value.groups.length === GROUP_COUNT, 'Expected 14 source groups');
  const groupIds = new Set<string>();
  const wordIds = new Set<string>();
  const sourceRows = new Set<number>();
  for (let index = 0; index < value.groups.length; index += 1) {
    const group: unknown = value.groups[index];
    requireCondition(isRecord(group) && isText(group.id), 'Invalid source group');
    requireCondition(group.id === `g${String(index + 1).padStart(2, '0')}`, 'Unexpected source group ID');
    requireCondition(!groupIds.has(group.id), 'Duplicate source group ID');
    groupIds.add(group.id);
    requireCondition(group.sequence === index + 1, 'Invalid group sequence');
    requireCondition(
      typeof group.sourceRow === 'number' && Number.isInteger(group.sourceRow) && group.sourceRow > 1 &&
        !sourceRows.has(group.sourceRow),
      'Invalid or duplicate source group row',
    );
    sourceRows.add(group.sourceRow);
    requireCondition(group.sourceRow === SOURCE_ROWS[index], 'Unexpected source group row');
    requireCondition(Array.isArray(group.words) && group.words.length === 4, 'Expected four source words');
    const dimensions = new Set<Dimension>();
    for (const rawWord of group.words) {
      const word: unknown = rawWord;
      requireCondition(isRecord(word) && isText(word.id), 'Invalid source word');
      requireCondition(/^w_[a-f0-9]{16}$/.test(word.id), 'Expected opaque word ID');
      requireCondition(!wordIds.has(word.id), 'Duplicate source word ID');
      wordIds.add(word.id);
      requireCondition(isText(word.textEn) && isText(word.textAr), 'Missing word translation');
      requireCondition(isDimension(word.dimension) && !dimensions.has(word.dimension), 'Invalid source dimension');
      dimensions.add(word.dimension);
      requireCondition(isRecord(word.source), 'Missing word source cells');
      const enCells = word.source.enCells;
      requireCondition(
        Array.isArray(enCells) && enCells.length > 0 &&
          enCells.every(cell => typeof cell === 'string' && /^[A-Z]+[1-9]\d*$/.test(cell)) &&
          typeof word.source.arCell === 'string' && /^[A-Z]+[1-9]\d*$/.test(word.source.arCell),
        'Invalid word source cells',
      );
      const [enColumn, arColumn] = SOURCE_COLUMNS[word.dimension];
      const expectedEnCells = word.dimension === 'D' && group.sourceRow === 6
        ? ['C6', 'C7'] : [`${enColumn}${group.sourceRow}`];
      requireCondition(
        enCells.length === expectedEnCells.length &&
          expectedEnCells.every((cell, position) => enCells[position] === cell) &&
          word.source.arCell === `${arColumn}${group.sourceRow}`,
        'Word source cells do not match the source dimension and row',
      );
    }
  }
  requireCondition(Array.isArray(value.profiles) && value.profiles.length === 12, 'Expected 12 source profiles');
  const profileCodes = new Set<ProfileCode>();
  const profileRows = new Set<number>();
  for (const rawProfile of value.profiles) {
    const profile: unknown = rawProfile;
    requireCondition(isRecord(profile) && isProfileCode(profile.code), 'Invalid profile code');
    requireCondition(!profileCodes.has(profile.code), 'Duplicate profile code');
    profileCodes.add(profile.code);
    requireCondition(isText(profile.labelAr), 'Missing Arabic profile label');
    requireCondition(
      profile.nameAr === profile.labelAr && profile.descriptionAr === profile.labelAr,
      'Profile name and short description must match the N slogan',
    );
    requireCondition(
      typeof profile.sourceRow === 'number' && Number.isInteger(profile.sourceRow) && profile.sourceRow > 1 &&
        !profileRows.has(profile.sourceRow),
      'Invalid or duplicate profile source row',
    );
    profileRows.add(profile.sourceRow);
    requireCondition(profile.sourceRow === PROFILE_ROWS[profile.code], 'Unexpected profile source row');
    for (const field of ['rawP', 'rawQ', 'rawR', 'descriptionEn']) {
      requireCondition(isNullableText(profile[field]), `Invalid profile field: ${field}`);
    }
  }
  requireCondition(PROFILE_CODES.every(code => profileCodes.has(code)), 'Incomplete profile lookup');
}

function validateAnswerForSeed(seed: AssessmentSeed, value: unknown): asserts value is Answer {
  requireCondition(isRecord(value) && isText(value.groupId), 'Invalid answer');
  const group = seed.groups.find(group => group.id === value.groupId);
  requireCondition(group, 'Unknown submitted group ID');
  const ids = value.rankedWordIds;
  requireCondition(Array.isArray(ids) && ids.length === 4, 'Invalid ranking length');
  requireCondition(
    Array.from(ids).every(id => typeof id === 'string') && new Set(ids).size === 4 &&
      ids.every(id => group.words.some(word => word.id === id)),
    'Ranking must be an exact group word permutation',
  );
}

/** Reusable per-group validation for the future confirmed-answer PUT handler. */
export function validateGroupAnswer(source: unknown, value: unknown): asserts value is Answer {
  validateAssessmentSeed(source);
  validateAnswerForSeed(source, value);
}

function validateAnswers(seed: AssessmentSeed, value: unknown): asserts value is readonly Answer[] {
  requireCondition(Array.isArray(value) && value.length === GROUP_COUNT, 'Incomplete assessment');
  const answeredGroups = new Set<string>();
  for (const rawAnswer of value) {
    const answer: unknown = rawAnswer;
    validateAnswerForSeed(seed, answer);
    requireCondition(!answeredGroups.has(answer.groupId), 'Duplicate submitted group ID');
    answeredGroups.add(answer.groupId);
  }
}

/**
 * Use only saved, confirmed answers loaded under the participant-row lock.
 * Raw input types are unknown so malformed JSON is rejected rather than trusted.
 */
export function scoreAssessment(source: unknown, submittedAnswers: unknown): AssessmentScores {
  validateAssessmentSeed(source);
  validateAnswers(source, submittedAnswers);
  const groupsById = new Map(source.groups.map(group => [group.id, group]));
  const scores: Record<Dimension, number> = { D: 0, I: 0, S: 0, C: 0 };
  for (const answer of submittedAnswers) {
    const group = groupsById.get(answer.groupId)!;
    const wordsById = new Map(group.words.map(word => [word.id, word]));
    answer.rankedWordIds.forEach((wordId, index) => {
      const dimension = wordsById.get(wordId)!.dimension;
      scores[dimension] += POINTS[index]!;
    });
  }
  const totalPoints = DIMENSIONS.reduce((sum, dimension) => sum + scores[dimension], 0);
  requireCondition(
    totalPoints === 140 && DIMENSIONS.every(dimension => scores[dimension] >= 14 && scores[dimension] <= 56),
    'Scoring invariant failure',
  );
  // Dimensions in one score group share a rank. Their array order is display-only.
  const dimensionsByScore = new Map<number, Dimension[]>();
  for (const dimension of DIMENSIONS) {
    const dimensions = dimensionsByScore.get(scores[dimension]) ?? [];
    dimensions.push(dimension);
    dimensionsByScore.set(scores[dimension], dimensions);
  }
  let nextRank = 1;
  const scoreRanking = [...dimensionsByScore.entries()]
    .sort(([leftScore], [rightScore]) => rightScore - leftScore)
    .map(([score, dimensions]) => {
      const entry = { rank: nextRank, score, dimensions };
      nextRank += dimensions.length;
      return entry;
    });
  const tiedScoreGroups = scoreRanking
    .filter(entry => entry.dimensions.length > 1)
    .map(({ score, dimensions }) => ({ score, dimensions: [...dimensions] }));

  // Every first must be a highest-scoring dimension; every second must be
  // highest among the remaining dimensions. Enumerate all valid ordered pairs.
  const highestScore = Math.max(...DIMENSIONS.map(dimension => scores[dimension]));
  const candidateProfileCodes = PROFILE_CODES.filter(profileCode => {
    const first = profileCode[0] as Dimension;
    const second = profileCode[1] as Dimension;
    const remainingHighest = Math.max(...DIMENSIONS
      .filter(dimension => dimension !== first)
      .map(dimension => scores[dimension]));
    return scores[first] === highestScore && scores[second] === remainingHighest;
  });
  requireCondition(candidateProfileCodes.length > 0, 'No valid profile candidates');
  // Copy source content so changing a returned report cannot mutate the seed.
  const candidateProfiles = candidateProfileCodes.map(profileCode =>
    ({ ...source.profiles.find(profile => profile.code === profileCode)! }));
  const profileStatus = candidateProfileCodes.length === 1 ? 'SINGLE' : 'TIED';
  return {
    assessmentVersion: source.assessmentVersion,
    scoringPolicyVersion: source.scoringPolicyVersion,
    profileTextPolicyVersion: source.profileTextPolicyVersion,
    scores,
    scoreRanking,
    totalPoints,
    hasScoreTie: tiedScoreGroups.length > 0,
    tiedScoreGroups,
    profileStatus,
    profileCode: profileStatus === 'SINGLE' ? candidateProfileCodes[0]! : null,
    profile: profileStatus === 'SINGLE' ? candidateProfiles[0]! : null,
    candidateProfileCodes,
    candidateProfiles,
  };
}

/** Safe GET /api/assessment word DTO. Add own saved rankings in the API service. */
export function toPublicAssessment(source: unknown): PublicAssessment {
  validateAssessmentSeed(source);
  return {
    assessmentVersion: source.assessmentVersion,
    groups: source.groups.map(group => ({
      id: group.id,
      sequence: group.sequence,
      words: group.words.map(word => ({ id: word.id, textEn: word.textEn, textAr: word.textAr })),
    })),
  };
}
