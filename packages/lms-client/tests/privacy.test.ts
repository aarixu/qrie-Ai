// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PRIVACY_VERSION, privacyContact, privacyHost, privacyNotice, type PrivacyNotice, type PrivacyOptions } from '../src/index.ts';

/**
 * THE PRIVACY NOTICE BOTH APPS SHOW AT /privacy (the 2026-10-08 security
 * review, part 2: "Notice"). Written first.
 *
 * One text for a parent and for a teacher: who runs the apps, what is kept
 * and why, who sees it, Draft with AI, what stays on the phone, where it is
 * kept, the rights, and whom to ask. It says only what the code does today:
 * no keeping periods, no automatic deletion, no country of hosting, no
 * language but English.
 */

const hosted: PrivacyOptions = {
  demo: false,
  https: true,
  googleFonts: false,
  contact: 'privacy@school.example',
  webHost: null,
  backupHost: null,
};
const onAzure: PrivacyOptions = { ...hosted, webHost: 'Microsoft Azure', backupHost: 'Microsoft Azure' };
const variants: PrivacyOptions[] = [
  hosted,
  onAzure,
  { demo: true, https: false, googleFonts: true, contact: null, webHost: null, backupHost: null },
  { demo: false, https: false, googleFonts: true, contact: null, webHost: 'Microsoft Azure', backupHost: null },
];

const textOf = (n: PrivacyNotice) =>
  [n.title, n.intro, n.version, n.note ?? '', ...n.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.list ?? []), s.email ?? ''])].join('\n');
const section = (n: PrivacyNotice, heading: string) => {
  const s = n.sections.find((x) => x.heading === heading);
  if (!s) throw new Error(`no section "${heading}"`);
  return [...s.paragraphs, ...(s.list ?? [])].join('\n');
};

describe('the privacy contact the app is built with', () => {
  it('is an email address, trimmed', () => {
    expect(privacyContact('privacy@school.example')).toBe('privacy@school.example');
    expect(privacyContact('  Privacy@Qrie.example \n')).toBe('Privacy@Qrie.example');
  });

  it('is none when unset or not an email address', () => {
    for (const raw of [undefined, null, '', '   ', 'privacy', 'a@b', 'two words@school.example', 'mailto:privacy@school.example', 'a@b@c.example']) {
      expect(privacyContact(raw), String(raw)).toBeNull();
    }
  });
});

describe('a host the app is built with (VITE_QRIE_WEB_HOST, VITE_QRIE_BACKUP_HOST)', () => {
  it('is its name, trimmed', () => {
    expect(privacyHost('Microsoft Azure')).toBe('Microsoft Azure');
    expect(privacyHost('  Microsoft Azure \n')).toBe('Microsoft Azure');
  });

  it('is none when unset or blank', () => {
    for (const raw of [undefined, null, '', '   ']) expect(privacyHost(raw), String(raw)).toBeNull();
  });
});

describe('the notice', () => {
  it('has its title, its version, and its sections in order', () => {
    const n = privacyNotice(hosted);
    expect(n.title).toBe('Privacy notice');
    expect(n.version).toBe('Version of 11 October 2026');
    expect(PRIVACY_VERSION).toBe(n.version);
    expect(n.sections.map((s) => s.heading)).toEqual([
      'Who runs this',
      'What is kept, and why',
      'Who can see it',
      'Draft with AI',
      'No advertising, no tracking',
      'On your device',
      'Where it is kept',
      'Your rights',
      'Who to contact',
    ]);
  });

  it('says the school decides and Qrie keeps the data for the school', () => {
    const said = section(privacyNotice(hosted), 'Who runs this');
    expect(said).toContain('Your school decides what is kept and why.');
    expect(said).toContain('Qrie runs the apps and keeps the data for your school.');
  });

  it('lists each kind of data the schema keeps, with its reason', () => {
    const kept = privacyNotice(hosted).sections.find((s) => s.heading === 'What is kept, and why')!.list!;
    const has = (...words: string[]) => expect(kept.some((line) => words.every((w) => line.includes(w))), words.join(' + ')).toBe(true);
    has('Names', 'login IDs', 'class', 'roll number', 'classes and subjects each teacher teaches');
    has('PIN', 'only in scrambled form');
    has('wrong PIN tries', 'internet address');
    has('answers', 'photos of written work', 'marks', 'comments');
    has('Qrie’s learning model', 'which common mistakes those answers show', 'teachers can set practice on those mistakes');
    has('Attendance', 'remark on the report card');
    has('Notices', 'who has opened');
    has('photo of a student or teacher');
    has('Which parent is linked to which child');
    has('log of changes', 'Only the school admin sees it.');
    has(
      'When a teacher or the school admin uses Draft with AI',
      'a record of each request',
      'who asked, when, which AI model answered, whether it worked, and how long the request and the answer were',
      'how much each person has used it that day',
      'to keep the AI’s use and its cost within limits',
    );
    for (const line of kept) expect(line, line).toMatch(/ — (to|so) /);
  });

  it('says who sees what', () => {
    const said = section(privacyNotice(hosted), 'Who can see it');
    expect(said).toContain('No student sees another student’s work or marks.');
    expect(said).toContain('A parent: only their own children');
    expect(said).toContain('A teacher: the students in the classes they teach this year');
    expect(said).toContain('The school admin: the whole school');
  });

  it('says what Draft with AI sends, where, and that no child sees a draft until a teacher adds it', () => {
    const said = section(privacyNotice(hosted), 'Draft with AI');
    expect(said).toContain('the class, subject, chapter and topic, how many questions to write, and the note the teacher writes');
    expect(said).toContain('the app adds nothing about any child');
    expect(said).toContain('Gemini, Google’s AI model');
    expect(said).toContain('No child sees a draft until a teacher adds it.');
    expect(said).toContain('The Student and Parent app sends nothing to the AI.');
  });

  it('says Draft with AI is on when Qrie has switched it on in the app, not that a school can switch it', () => {
    const said = section(privacyNotice(hosted), 'Draft with AI');
    expect(said).toContain('in the Teacher app, when Qrie has switched it on in the app.');
    expect(said).not.toMatch(/for the school|for your school/);
  });

  it('says what stays on the device, and that the Android apps keep it out of backups', () => {
    const said = section(privacyNotice(hosted), 'On your device');
    expect(said).toContain('work waiting for the internet');
    expect(said).toContain('out of phone backups');
  });

  it('says what stays on the device stays after signing out, until it is handed in or sent, or the app’s data is cleared', () => {
    const said = section(privacyNotice(hosted), 'On your device');
    expect(said).toContain('the answers chosen so far in a quiz or test are kept on the device until the quiz or test is handed in');
    expect(said).toContain('work waiting for the internet (answers and photos) until it is sent or the school turns it down');
    expect(said).toContain('Signing out does not remove them; clearing the app’s data does.');
    expect(said).not.toContain('while they wait');
  });

  it('names Supabase, and says https only when every address the app was built with is https', () => {
    expect(section(privacyNotice(hosted), 'Where it is kept')).toContain('Supabase');
    expect(textOf(privacyNotice(hosted))).toContain('over https');
    expect(textOf(privacyNotice({ ...hosted, https: false }))).not.toContain('https');
    expect(textOf(privacyNotice({ ...hosted, demo: true }))).not.toContain('https');
  });

  it('names where the pages are served from, and where backups are kept, only for a build that says so', () => {
    const said = section(privacyNotice(onAzure), 'Where it is kept');
    expect(said).toContain(
      'The app’s pages come from a server at Microsoft Azure, which keeps a log of the requests made to it, each with the internet address it came from.',
    );
    expect(said).toContain('Each night a backup copy of the school’s data, without the photos and other files, is made and kept with Microsoft Azure.');
    expect(said).toContain('Supabase');

    const pagesOnly = section(privacyNotice({ ...hosted, webHost: 'Microsoft Azure' }), 'Where it is kept');
    expect(pagesOnly).toContain('a server at Microsoft Azure');
    expect(pagesOnly).not.toContain('backup');

    const neither = textOf(privacyNotice(hosted));
    expect(neither).not.toContain('Azure');
    expect(neither).not.toContain('a log of the requests');
    expect(neither).not.toContain('backup copy');
  });

  it('says a demo build talks to a demo school, and only a demo build says so', () => {
    expect(privacyNotice({ ...hosted, demo: true }).note).toContain('demo school');
    expect(privacyNotice(hosted).note).toBeNull();
  });

  it('names Google Fonts only for an app that loads its fonts from there', () => {
    expect(section(privacyNotice({ ...hosted, googleFonts: true }), 'No advertising, no tracking')).toContain('Google Fonts');
    expect(textOf(privacyNotice(hosted))).not.toContain('Google Fonts');
  });

  it('sends a complaint first to the contact, then to the Board', () => {
    const said = section(privacyNotice(hosted), 'Your rights');
    expect(said).toContain('to see the data kept about you or your child, to have it corrected, or to have it deleted');
    expect(said).toContain('withdraw');
    expect(said).toContain('start with the contact below');
    expect(said).toContain('the Data Protection Board of India');
  });

  it('gives the contact when there is one, and the school office when there is not', () => {
    const withEmail = privacyNotice(hosted).sections.at(-1)!;
    expect(withEmail.email).toBe('privacy@school.example');
    expect(withEmail.paragraphs.join(' ')).toContain('write to the address below');
    const without = privacyNotice({ ...hosted, contact: null }).sections.at(-1)!;
    expect(without.email).toBeUndefined();
    expect(without.paragraphs.join(' ')).toContain('ask your school office');
  });

  it('promises nothing the code does not do: no keeping periods, no automatic deletion, no country, no Hindi, no encryption', () => {
    for (const options of variants) {
      const text = textOf(privacyNotice(options));
      expect(text).not.toMatch(/\d+\s*(days?|weeks?|months?|years?)\b/i);
      expect(text).not.toMatch(/automatic/i);
      expect(text.replaceAll('Data Protection Board of India', '')).not.toMatch(/india|mumbai/i);
      expect(text).not.toMatch(/hindi/i);
      expect(text).not.toMatch(/encrypt/i);
    }
  });
});
