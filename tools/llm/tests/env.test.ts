import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvFiles, parseEnvFile } from '../env.ts';

describe('parseEnvFile', () => {
  it('reads KEY=value, skipping blanks and comments', () => {
    expect(
      parseEnvFile('# a comment\n\nA=1\n  B = two words \n#C=3\n'),
    ).toEqual({ A: '1', B: 'two words' });
  });

  it('strips matching surrounding quotes, and only those', () => {
    expect(parseEnvFile(`A="quoted"\nB='single'\nC=un"quoted"`)).toEqual({
      A: 'quoted',
      B: 'single',
      C: 'un"quoted"',
    });
  });

  it('keeps everything after the first = — keys contain no =, values do', () => {
    expect(parseEnvFile('URL=https://x/y?a=b&c=d')).toEqual({ URL: 'https://x/y?a=b&c=d' });
  });

  it('ignores a line with no = and a line starting with =', () => {
    expect(parseEnvFile('nonsense\n=value\nA=1')).toEqual({ A: '1' });
  });

  it('first value wins on a duplicate key', () => {
    expect(parseEnvFile('A=first\nA=second')).toEqual({ A: 'first' });
  });
});

describe('loadEnvFiles', () => {
  const made: string[] = [];
  const touched: string[] = [];

  const tempRoot = (files: Record<string, string>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curie-env-'));
    made.push(dir);
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    return dir;
  };

  const track = (...keys: string[]) => touched.push(...keys);

  afterEach(() => {
    for (const key of touched.splice(0)) delete process.env[key];
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fills process.env from .env.local', () => {
    track('CURIE_TEST_KEY');
    const dir = tempRoot({ '.env.local': 'CURIE_TEST_KEY=from-file' });
    expect(loadEnvFiles(dir)).toContain('CURIE_TEST_KEY');
    expect(process.env.CURIE_TEST_KEY).toBe('from-file');
  });

  it('never clobbers a real environment variable', () => {
    // A one-off `KEY=... node tools/...` must beat a file edited last week.
    track('CURIE_TEST_KEY');
    process.env.CURIE_TEST_KEY = 'from-shell';
    const dir = tempRoot({ '.env.local': 'CURIE_TEST_KEY=from-file' });
    expect(loadEnvFiles(dir)).not.toContain('CURIE_TEST_KEY');
    expect(process.env.CURIE_TEST_KEY).toBe('from-shell');
  });

  it('prefers .env.local over .env for the same key', () => {
    track('CURIE_TEST_KEY');
    const dir = tempRoot({ '.env.local': 'CURIE_TEST_KEY=local', '.env': 'CURIE_TEST_KEY=plain' });
    loadEnvFiles(dir);
    expect(process.env.CURIE_TEST_KEY).toBe('local');
  });

  it('reads both files, so .env can hold what .env.local does not', () => {
    track('CURIE_TEST_A', 'CURIE_TEST_B');
    const dir = tempRoot({ '.env.local': 'CURIE_TEST_A=a', '.env': 'CURIE_TEST_B=b' });
    loadEnvFiles(dir);
    expect(process.env.CURIE_TEST_A).toBe('a');
    expect(process.env.CURIE_TEST_B).toBe('b');
  });

  it('is silent when no env file exists — a shell-only setup is normal', () => {
    expect(loadEnvFiles(tempRoot({}))).toEqual([]);
  });
});
