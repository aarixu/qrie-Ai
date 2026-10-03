import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoAnswers, runFounder } from './founder.ts';

/**
 * npm run founder -- list
 * npm run founder -- set <SCHOOL-CODE> --plan pilot --seats 500 --until 2027-03-31
 *
 * The founder console (./founder.ts) over the demo school's database in
 * tools/lms-demo/.demo-data/db, which `npm run demo` builds.
 */

const DB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.demo-data/db');

runFounder(process.argv.slice(2), { dbDir: DB, isRunning: demoAnswers, print: (text) => console.log(text) })
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error((e as Error).message);
    process.exit(1);
  });
