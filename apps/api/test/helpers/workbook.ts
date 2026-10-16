import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { AssessmentSeed } from '../../src/domain/scoring.ts';

// Independent workbook controls, not imported from the scorer being tested.
const workbookSha256 = '57b23a2a2b8679ba669e3657d282c053bb26ec6a7da5965388adf6f89dcdaf60';
const sourceRows = [2, 4, 6, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29];
const columns = { C: ['A', 'B'], D: ['C', 'D'], S: ['E', 'F'], I: ['G', 'H'] } as const;
const profileRows = [2, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23];

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), 'Expected XML object');
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), 'Expected XML array');
  return value;
}

function text(value: unknown): string {
  const result = typeof value === 'string' ? value : object(value)['#text'];
  assert.equal(typeof result, 'string');
  return result as string;
}

function richText(value: unknown): string {
  const node = object(value);
  if (node.t !== undefined) return text(node.t);
  return array(node.r ?? []).map(run => text(object(run).t)).join('');
}

export function readWorkbookCells(bytes: Uint8Array): Map<string, string> {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), workbookSha256, 'Workbook byte fingerprint');
  // Read the known local XLSX into memory; no archive entries are written to disk.
  const files = unzipSync(bytes);
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: false,
    alwaysCreateTextNode: true,
    isArray: (name, _path, _leaf, attribute) => !attribute && ['si', 'r', 'row', 'c', 'sheet', 'Relationship'].includes(name),
  });
  function xml(name: string): Record<string, unknown> {
    const entry = files[name];
    assert.ok(entry, `Missing workbook part ${name}`);
    const parsed: unknown = parser.parse(strFromU8(entry));
    return object(parsed);
  }
  const sheets = array(object(object(xml('xl/workbook.xml').workbook).sheets).sheet);
  assert.equal(sheets.length, 1);
  const sheet = object(sheets[0]);
  assert.equal(sheet['@_name'], '2024 English - arabic');
  assert.ok(sheet['@_state'] === undefined || sheet['@_state'] === 'visible');
  const relationships = array(object(xml('xl/_rels/workbook.xml.rels').Relationships).Relationship);
  const relationship = relationships.map(object).find(item => item['@_Id'] === sheet['@_r:id']);
  assert.ok(relationship);
  assert.equal(typeof relationship['@_Target'], 'string');
  const sheetPath = posix.join('xl', relationship['@_Target'] as string);
  const worksheet = object(xml(sheetPath).worksheet);
  assert.equal(object(worksheet.dimension)['@_ref'], 'A1:R36');
  const strings = array(object(xml('xl/sharedStrings.xml').sst).si).map(richText);
  const cells = new Map<string, string>();
  for (const row of array(object(worksheet.sheetData).row)) {
    for (const rawCell of array(object(row).c)) {
      const cell = object(rawCell);
      assert.equal(typeof cell['@_r'], 'string');
      let value = '';
      if (cell['@_t'] === 'inlineStr') value = richText(cell.is);
      else if (cell.v !== undefined) {
        value = text(cell.v);
        if (cell['@_t'] === 's') {
          const shared = strings[Number(value)];
          assert.notEqual(shared, undefined);
          value = shared!;
        }
      }
      cells.set(cell['@_r'] as string, value.trim());
    }
  }
  return cells;
}

export function validateWorkbookAgainstSeed(seed: AssessmentSeed, bytes: Uint8Array) {
  const cells = readWorkbookCells(bytes);
  const cell = (address: string): string => cells.get(address) ?? '';
  assert.equal(seed.sourceSha256, workbookSha256);
  assert.equal(seed.sourceSheet, '2024 English - arabic');
  assert.deepEqual(seed.groups.map(group => group.sourceRow), sourceRows);
  assert.equal(seed.groups.length, 14);
  for (const group of seed.groups) {
    assert.equal(group.words.length, 4);
    for (const word of group.words) {
      const [en, ar] = columns[word.dimension];
      assert.equal(cell(`${en}33`), word.dimension);
      const enCells = word.dimension === 'D' && group.sourceRow === 6 ? ['C6', 'C7'] : [`${en}${group.sourceRow}`];
      assert.deepEqual(word.source.enCells, enCells);
      assert.equal(word.source.arCell, `${ar}${group.sourceRow}`);
      assert.equal(word.textEn, enCells.map(cell).join(''), `English source ${enCells.join('+')}`);
      assert.equal(word.textAr, cell(`${ar}${group.sourceRow}`), `Arabic source ${ar}${group.sourceRow}`);
    }
  }
  assert.equal(seed.profiles.length, 12);
  assert.deepEqual(seed.profiles.map(profile => profile.sourceRow), profileRows);
  for (const profile of seed.profiles) {
    const row = profile.sourceRow;
    assert.equal(profile.code, `${cell(`L${row}`)}${cell(`M${row}`)}`.toUpperCase());
    assert.equal(profile.labelAr, cell(`N${row}`));
    assert.equal(profile.nameAr, cell(`N${row}`));
    assert.equal(profile.descriptionAr, cell(`N${row}`));
    assert.equal(profile.descriptionEn, null);
    for (const column of ['P', 'Q', 'R'] as const) {
      assert.equal(profile[`raw${column}`], cell(`${column}${row}`) || null, `Raw ${column}${row}`);
    }
  }
  const words = seed.groups.flatMap(group => group.words);
  assert.equal(words.length, 56);
  assert.equal(new Set(words.map(word => word.id)).size, 56);
  assert.equal(new Set(words.map(word => word.textEn)).size, 55);
  return { groups: 14, words: 56, profiles: 12, sha256: workbookSha256 };
}
