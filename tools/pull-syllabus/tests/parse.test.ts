import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  filterBooks,
  parseNcertCatalogue,
  pickPrimaryBook,
  slugify,
  type NcertBook,
} from '../src/parse.ts';

/**
 * Everything here runs against the SAVED copy of ncert.nic.in/textbook.php in
 * cache/. Never the network: the pull has to be reproducible, and NCERT's
 * server is far too slow to sit inside a test run.
 */
const html = fs.readFileSync(
  path.resolve('tools/pull-syllabus/cache/ncert-textbook-index.html'),
  'utf8',
);

const catalogue = parseNcertCatalogue(html);

describe('parseNcertCatalogue', () => {
  it('reads the whole catalogue out of the inline dropdown JavaScript', () => {
    expect(catalogue).toHaveLength(1212);
  });

  it('maps Class 10 Science to book code jesc1 with 13 chapters', () => {
    const science = catalogue.find(
      (b) => b.klass === 10 && b.subject === 'Science' && b.title === 'Science',
    );
    expect(science).toEqual({
      klass: 10,
      subject: 'Science',
      title: 'Science',
      code: 'jesc1',
      chapters: 13,
    });
  });

  it('gives every book a positive chapter count and a usable code', () => {
    for (const book of catalogue) {
      expect(book.chapters).toBeGreaterThan(0);
      expect(book.code).toMatch(/^[a-z0-9]+$/);
    }
  });
});

describe('filterBooks', () => {
  const kept = filterBooks(catalogue);
  const titles = kept.map((b) => b.title);
  const codes = new Set(kept.map((b) => b.code));

  it('excludes classes outside 6..12', () => {
    expect(catalogue.some((b) => b.klass < 6)).toBe(true);
    expect(catalogue.some((b) => b.klass > 12)).toBe(true);
    for (const book of kept) {
      expect(book.klass).toBeGreaterThanOrEqual(6);
      expect(book.klass).toBeLessThanOrEqual(12);
    }
  });

  it('drops the Sanskrit and Maithili translated editions the draft filter missed', () => {
    // Present in the catalogue...
    expect(catalogue.some((b) => b.title === 'Ganita Prakash (Sanskrit)')).toBe(true);
    expect(catalogue.some((b) => b.title === 'Ganita Prakash (Maithili)')).toBe(true);
    // ...and gone after filtering.
    expect(titles).not.toContain('Ganita Prakash (Sanskrit)');
    expect(titles).not.toContain('Ganita Prakash (Maithili)');
    expect(codes.has('fskgp1')).toBe(false);
    expect(codes.has('fmtgp1')).toBe(false);
  });

  it('drops every translated edition, whatever the language tag', () => {
    for (const title of titles) {
      expect(title).not.toMatch(
        /\(\s*(Hindi|Urdu|Sanskrit|Maithili|Maithli|Dogri|Konkani|Kashmiri|Bengali|Tamil|Telugu|Kannada|Malayalam|Odia|Oriya|Assamese|Nepali|Manipuri|Bodo|Santhali|Punjabi|Marathi|Gujarati|Gujrati|Sindhi)\s*\)/i,
      );
    }
    // A tag appended after a spaced dash is a translation too.
    expect(titles).not.toContain('Computer Science - Urdu');
  });

  it('keeps a language subject whose own textbook is named in that language', () => {
    expect(titles).toContain('Shemushi'); // Class 10 Sanskrit
    // These end in "-Urdu" but are the Urdu subject's real books, not
    // translations of something else.
    expect(titles).toContain('Gulzar-e-Urdu');
    expect(titles).toContain('Nawa-e-Urdu');
  });

  it('drops exemplar, lab manual, practical and supplementary editions', () => {
    for (const title of titles) {
      expect(title).not.toMatch(/ex[ae]mplar|lab\s*manual|prac?tical|\bsuppl?\b|supplementary/i);
    }
    expect(codes.has('jeep1')).toBe(false); // Class 10 Science Exemplar Problem
    expect(codes.has('jelm1')).toBe(false); // Class 10 Science Lab Manual
    expect(codes.has('legy3')).toBe(false); // Class 12 Practical Work in Geography
    expect(codes.has('kegy3')).toBe(false); // ...and NCERT's "Pratical" spelling of it
  });

  it('keeps the English textbook itself', () => {
    expect(codes.has('jesc1')).toBe(true);
    expect(codes.has('lemh1')).toBe(true);
  });

  it('narrows to the named subjects, case-insensitively', () => {
    const science = filterBooks(catalogue, { subjects: ['science'] });
    expect(science.length).toBeGreaterThan(0);
    for (const book of science) expect(book.subject).toBe('Science');
  });

  it('honours an explicit class range', () => {
    const tenth = filterBooks(catalogue, { minClass: 10, maxClass: 10 });
    for (const book of tenth) expect(book.klass).toBe(10);
  });
});

describe('pickPrimaryBook', () => {
  const forSubject = (klass: number, subject: string): NcertBook[] =>
    pickPrimaryBook(filterBooks(catalogue, { minClass: klass, maxClass: klass, subjects: [subject] }));

  it('keeps only the English edition where a Hindi one shares the subject', () => {
    // "Vigyan" (jhsc1) carries no language tag in its title — only the code says
    // it is the Hindi edition.
    const books = forSubject(10, 'Science');
    expect(books.map((b) => b.code)).toEqual(['jesc1']);
  });

  it('returns every part of a multi-part book, in a stable order', () => {
    const maths = forSubject(12, 'Mathematics');
    expect(maths.map((b) => b.code)).toEqual(['lemh1', 'lemh2']);
    expect(maths.map((b) => b.title)).toEqual(['Mathematics Part-I', 'Mathematics Part-II']);
  });

  it('returns all four Class 10 Social Science books, since all four are taught', () => {
    const social = forSubject(10, 'Social Science');
    expect(social.map((b) => b.code)).toEqual(['jess1', 'jess2', 'jess3', 'jess4']);
  });

  it('falls back to what exists for a subject with no English edition', () => {
    const sanskrit = forSubject(10, 'Sanskrit');
    expect(sanskrit.length).toBeGreaterThan(0);
    expect(sanskrit.map((b) => b.title)).toContain('Shemushi');
  });

  it('does not mutate its input', () => {
    const input = filterBooks(catalogue, { minClass: 12, maxClass: 12, subjects: ['Mathematics'] });
    const before = input.map((b) => b.code);
    pickPrimaryBook(input);
    expect(input.map((b) => b.code)).toEqual(before);
  });
});

describe('slugify', () => {
  it('makes a url-safe id from a human title', () => {
    expect(slugify('Life Processes')).toBe('life-processes');
    expect(slugify('What are Life Processes?')).toBe('what-are-life-processes');
    expect(slugify('Acids, Bases and Salts')).toBe('acids-bases-and-salts');
    expect(slugify('Social Science')).toBe('social-science');
  });

  it('leaves no leading, trailing or doubled separators', () => {
    expect(slugify('  --Chapter 5:  Light--  ')).toBe('chapter-5-light');
    expect(slugify('India -People And Economy')).toBe('india-people-and-economy');
  });

  it('truncates without leaving a dangling hyphen', () => {
    const long = slugify('Some Extremely Long NCERT Chapter Title About Everything At Once');
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long).not.toMatch(/-$/);
  });
});
