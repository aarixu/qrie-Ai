/**
 * THE PRIVACY NOTICE, as both apps show it at /privacy (the 2026-10-08
 * security review, part 2: "Notice").
 *
 * One text, for a parent and for a teacher alike. What it lists is the data
 * map of that review, checked against the schema (migrations 0021-0046) and
 * the apps. It says only what the code does today: it names no keeping
 * period, no automatic deletion and no country of hosting, because none is
 * built or confirmed. A sentence that is true of one build only — the demo
 * school, https, the teacher app's web fonts — is said only by that build,
 * from the options each app passes.
 */

export const PRIVACY_VERSION = 'Version of 10 October 2026';

export interface PrivacySection {
  heading: string;
  /** Shown first. */
  paragraphs: string[];
  /** Shown after the paragraphs, as a bulleted list. */
  list?: string[];
  /** An address to write to, shown last, as a link. */
  email?: string;
}

export interface PrivacyNotice {
  title: string;
  intro: string;
  version: string;
  /** Said only by a build for the demo school. */
  note: string | null;
  sections: PrivacySection[];
}

export interface PrivacyOptions {
  /** The app is built for the demo school (its backend's mode is 'demo'). */
  demo: boolean;
  /** Every address the app was built to reach begins with https://. */
  https: boolean;
  /** The app's page loads fonts from Google Fonts (the teacher app's index.html does). */
  googleFonts: boolean;
  /** The privacy contact's email address (privacyContact), or null. */
  contact: string | null;
}

const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** The contact an app was built with (VITE_QRIE_PRIVACY_CONTACT), when it is an email address; else null. */
export function privacyContact(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  return EMAIL.test(value) ? value : null;
}

export function privacyNotice(o: PrivacyOptions): PrivacyNotice {
  const asking = 'To ask about your data, use these rights or complain,';
  return {
    title: 'Privacy notice',
    intro: 'What the Qrie apps keep about students, parents and teachers, why, who can see it, and what you can ask for.',
    version: PRIVACY_VERSION,
    note: o.demo
      ? 'This copy of the app is built for a demo school. Its people are made up, and it talks to a demo server, not to the hosted service this notice describes.'
      : null,
    sections: [
      {
        heading: 'Who runs this',
        paragraphs: [
          'Your school uses Qrie for its homework, tests, attendance and notices: the Teacher app and School Portal for staff, and the Student and Parent app for families.',
          'Your school decides what is kept and why. Qrie runs the apps and keeps the data for your school.',
        ],
      },
      {
        heading: 'What is kept, and why',
        paragraphs: [],
        list: [
          'Names and login IDs; each student’s class, section and roll number; the classes and subjects each teacher teaches; and when someone joins or leaves the school — to run the school.',
          'Your PIN — to sign you in. The school’s server keeps it only in scrambled form, never as the PIN itself. A new PIN is shown once, when it is made, so that it can be given to you.',
          'Counts of wrong PIN tries, for each ID and for each internet address sign-ins come from — to stop anyone guessing a PIN.',
          'Homework, tests and practice: the answers given in the app, ticks on notebook checklists, photos of written work, when a test was started and when work was handed in, marks, and teachers’ comments — so that teachers can mark work and report on it.',
          'How well each chapter is known, as Qrie’s learning model works it out from those answers — so that students, parents and teachers can see what needs practice.',
          'Attendance for each day it is marked, and the remark on the report card — to keep the school’s records and report to parents.',
          'Notices sent through the apps, any file sent with them, and who has opened each one — to reach students, parents and teachers.',
          'A photo of a student or teacher, if the school adds one — so that people can be recognised in the apps.',
          'Which parent is linked to which child — so that a parent sees only their own child.',
          'A log of changes the school’s staff make, such as adding people, giving new PINs, linking parents, sending notices and writing report remarks, with who made each change and when — so that the school can check who did what. Only the school admin sees it.',
        ],
      },
      {
        heading: 'Who can see it',
        paragraphs: [],
        list: [
          'A student: their own work, marks, attendance and progress, and the notices for their class and for the whole school. No student sees another student’s work or marks.',
          'A parent: only their own children — their work, marks, attendance and progress — and the notices for their child’s class and for the whole school.',
          'A teacher: the students in the classes they teach this year — their attendance, and their work, marks and progress in the subjects that teacher teaches.',
          'The school admin: the whole school — every class, student, teacher and parent — and the log of changes.',
        ],
      },
      {
        heading: 'Draft with AI',
        paragraphs: [
          'Teachers and the school admin can ask an AI to draft multiple-choice questions, in the Teacher app, when this is switched on for the school.',
          'The request carries the class, subject, chapter and topic, how many questions to write, and the note the teacher writes; the app adds nothing about any child, so do not write about a child in the note. It goes to Gemini, Google’s AI model.',
          'The questions come back as drafts that only the teacher who asked can see. No child sees a draft until a teacher adds it. The Student and Parent app sends nothing to the AI.',
        ],
      },
      {
        heading: 'No advertising, no tracking',
        paragraphs: [
          'There is no advertising in the apps, and no analytics or tracking tools.',
          ...(o.googleFonts
            ? ['The Teacher app loads its fonts from Google Fonts, so Google sees the internet address of the device it opens on.']
            : []),
        ],
      },
      {
        heading: 'On your device',
        paragraphs: [
          'The app keeps your sign-in on this device until you sign out or it expires.',
          'In the Student and Parent app, the answers chosen so far in a quiz or test, and work waiting for the internet (answers and photos), are kept on the device while they wait to be sent.',
          'The Android apps keep all of this out of phone backups and out of transfers to a new phone.',
        ],
      },
      {
        heading: 'Where it is kept',
        paragraphs: [
          'The school’s data is kept with Supabase, a cloud database service that Qrie uses to run the school’s server. Photos of written work are kept in its private file storage.',
          ...(o.https && !o.demo ? ['This app reaches it over https, which protects what it sends on the way.'] : []),
        ],
      },
      {
        heading: 'Your rights',
        paragraphs: [
          'You can ask to see the data kept about you or your child, to have it corrected, or to have it deleted. You can withdraw consent you have given, for yourself or for your child.',
          'To do any of this, or to complain, start with the contact below. If you are not satisfied with the answer, you can complain to the Data Protection Board of India.',
        ],
      },
      o.contact
        ? {
            heading: 'Who to contact',
            paragraphs: [`${asking} write to the address below. You can also ask your school office.`],
            email: o.contact,
          }
        : {
            heading: 'Who to contact',
            paragraphs: [`${asking} ask your school office.`],
          },
    ],
  };
}
