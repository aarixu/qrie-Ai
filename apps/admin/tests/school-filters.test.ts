import type { Level, SchoolRow } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import { filterSchools, matchSchool, type SchoolFilter } from '../src/lib/school-filters.ts';

/** The schools list's filters and Ctrl+K's school match. Written first. */

const row = (code: string, name: string, healthLevel: Level, paymentLevel: Level, offboarded = false): SchoolRow => ({
  orgId: code,
  code,
  name,
  plan: null,
  seats: null,
  seatsUsed: 0,
  validUntil: null,
  daysLeft: null,
  paymentLevel,
  paymentReason: '',
  healthLevel,
  healthLabel: '',
  lastActive: null,
  students: 0,
  teachers: 0,
  offboarded,
});

const rows = [
  row('DPS1', 'Delhi Public School', 'green', 'grey'),
  row('KV22', 'Kendriya Vidyalaya', 'red', 'amber'),
  row('SXC', "St Xavier's", 'amber', 'red', true),
  row('MOD', 'Modern School', 'grey', 'grey'),
];
const all: SchoolFilter = { text: '', health: [], payment: [], offboarded: 'show' };
const codes = (f: Partial<SchoolFilter>) => filterSchools(rows, { ...all, ...f }).map((r) => r.code);

describe('filtering the schools list', () => {
  it('text matches a code prefix or a name, any case', () => {
    expect(codes({ text: 'kv' })).toEqual(['KV22']);
    expect(codes({ text: 'public' })).toEqual(['DPS1']);
    expect(codes({ text: '  SCHOOL ' })).toEqual(['DPS1', 'MOD']);
    expect(codes({ text: '22' })).toEqual([]);
    expect(codes({ text: '' })).toEqual(['DPS1', 'KV22', 'SXC', 'MOD']);
  });

  it('health and payment filters keep only the levels asked for; an empty list keeps all', () => {
    expect(codes({ health: ['red', 'amber'] })).toEqual(['KV22', 'SXC']);
    expect(codes({ payment: ['grey'] })).toEqual(['DPS1', 'MOD']);
    expect(codes({ health: ['green'], payment: ['amber'] })).toEqual([]);
    expect(codes({ health: [], payment: [] })).toHaveLength(4);
  });

  it('offboarded schools can be hidden, shown or shown alone', () => {
    expect(codes({ offboarded: 'hide' })).toEqual(['DPS1', 'KV22', 'MOD']);
    expect(codes({ offboarded: 'show' })).toHaveLength(4);
    expect(codes({ offboarded: 'only' })).toEqual(['SXC']);
  });

  it('matchSchool lists code matches before name matches, at most 8', () => {
    const index = [
      { code: 'ABC', name: 'Zebra School' },
      { code: 'ZED', name: 'Abacus School' },
      { code: 'ABD', name: 'Another' },
    ];
    expect(matchSchool('ab', index).map((s) => s.code)).toEqual(['ABC', 'ABD', 'ZED']);
    expect(matchSchool('ZEBRA', index).map((s) => s.code)).toEqual(['ABC']);
    expect(matchSchool('', index)).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => ({ code: `S${i + 10}`, name: `School ${i}` }));
    expect(matchSchool('s', many)).toHaveLength(8);
  });
});
