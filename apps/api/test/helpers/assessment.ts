import { loadAssessmentSeed } from '../../src/data/assessment.ts';
import { DIMENSIONS, type Answer, type Dimension } from '../../src/domain/scoring.ts';

export const seed = loadAssessmentSeed();

export const order = (dimensions: readonly Dimension[]): Answer[] => seed.groups.map(group => ({
  groupId: group.id,
  rankedWordIds: dimensions.map(dimension => group.words.find(word => word.dimension === dimension)!.id),
}));

export const mixed = (first: readonly Dimension[], second: readonly Dimension[]): Answer[] =>
  [...order(first).slice(0, 7), ...order(second).slice(7)];

export function permutations(values: readonly Dimension[]): Dimension[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, other) => index !== other)).map(rest => [value, ...rest]));
}

export const allOrders = permutations(DIMENSIONS);

/** Deliberately corrupt untrusted JSON without weakening the test's TS types. */
export function changedAt(value: unknown, path: readonly (string | number)[], replacement: unknown, remove = false): unknown {
  const copy: unknown = structuredClone(value);
  let parent: unknown = copy;
  for (const key of path.slice(0, -1)) {
    if (typeof parent !== 'object' || parent === null) throw new Error('Invalid test path');
    parent = Reflect.get(parent, key);
  }
  const key = path.at(-1);
  if (typeof parent !== 'object' || parent === null || key === undefined) throw new Error('Invalid test path');
  if (remove) Reflect.deleteProperty(parent, key);
  else Reflect.set(parent, key, replacement);
  return copy;
}
