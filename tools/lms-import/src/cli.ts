import { applyPlan, type ImportResult } from './apply.ts';
import { planImport, type ImportPlan, type SchoolConfig } from './plan.ts';
import { renderSlips } from './slips.ts';
import { readStudents, readTeachers } from './sheet.ts';
import { supabaseStore } from './supabaseStore.ts';

/**
 * Import a school: `node tools/lms-import/src/cli.ts --school school.json
 *   --students students.csv --teachers teachers.csv [--apply --out slips.html]`
 *
 * Without --apply it is a DRY RUN: it reads and checks the sheets and says what
 * it would create, and touches nothing. --apply writes to the project named by
 * SUPABASE_URL with SUPABASE_SERVICE_ROLE_KEY from the environment, and needs
 * --out, because the PINs it creates are shown once, on that page, and never
 * again. PINs are never printed to the terminal.
 */

export interface CliDeps {
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
  log(line: string): void;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

const DEFAULT_LOGIN_URL = 'https://qrie-ai.vercel.app/app';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function summary(plan: ImportPlan): string[] {
  const kinds = { student: 0, teacher: 0, admin: 0 };
  for (const p of plan.people) kinds[p.kind] += 1;
  return [
    `${plan.people.length} accounts (${kinds.student} students, ${kinds.teacher} teachers, ${kinds.admin} admins)`,
    `${plan.sections.length} sections, ${plan.subjects.length} subjects, ${plan.assignments.length} teaching assignments`,
  ];
}

export async function run(args: string[], deps: CliDeps): Promise<number> {
  const schoolPath = flag(args, '--school');
  const studentsPath = flag(args, '--students');
  const teachersPath = flag(args, '--teachers');
  if (!schoolPath || !studentsPath || !teachersPath) {
    deps.log('Usage: lms-import --school school.json --students students.csv --teachers teachers.csv [--apply --out slips.html]');
    return 1;
  }

  const school = JSON.parse(deps.readFile(schoolPath)) as SchoolConfig;
  const s = readStudents(deps.readFile(studentsPath));
  const t = readTeachers(deps.readFile(teachersPath));
  const problems = [...s.errors, ...t.errors];
  if (problems.length) {
    deps.log(`The sheets have ${problems.length} problem(s). Nothing was imported.`);
    problems.forEach((p) => deps.log(`  ${p}`));
    return 1;
  }

  let plan: ImportPlan;
  try {
    plan = planImport(school, s.students, t.teachers);
  } catch (e) {
    deps.log(`Cannot import: ${(e as Error).message}`);
    return 1;
  }

  if (!args.includes('--apply')) {
    deps.log(`DRY RUN for ${school.displayName} (${school.code}) — nothing was written.`);
    summary(plan).forEach((l) => deps.log(`  would ensure ${l}`));
    deps.log('Run again with --apply --out slips.html to import.');
    return 0;
  }

  const url = deps.env.SUPABASE_URL;
  const key = deps.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    deps.log('--apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
    return 1;
  }
  const out = flag(args, '--out');
  if (!out) {
    deps.log('--apply needs --out slips.html: new PINs are shown once, on that page, and nowhere else.');
    return 1;
  }

  let result: ImportResult;
  try {
    result = await applyPlan(plan, supabaseStore(url, key, deps.fetchImpl));
  } catch (e) {
    deps.log(`Import stopped: ${(e as Error).message}`);
    deps.log('Everything before this point was kept. Fix the cause and run again; nothing is created twice.');
    return 1;
  }

  deps.writeFile(
    out,
    renderSlips({
      schoolCode: school.code,
      schoolName: school.displayName,
      loginUrl: deps.env.LMS_LOGIN_URL ?? DEFAULT_LOGIN_URL,
      created: result.created,
    }),
  );
  deps.log(`Imported ${school.displayName}: ${result.created.length} new accounts, ${result.existing.length} already there.`);
  deps.log(`Slips for the new accounts: ${out} — print it, then delete it.`);
  result.conflicts.forEach((c) => deps.log(`  NOT MOVED: ${c}`));
  return result.conflicts.length ? 2 : 0;
}

// Run only when invoked as the script, never when a test imports it.
if (process.argv[1] && /lms-import[\\/]src[\\/]cli\.ts$/.test(process.argv[1])) {
  const fs = await import('node:fs');
  run(process.argv.slice(2), {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    writeFile: (p, c) => fs.writeFileSync(p, c, 'utf8'),
    log: (l) => console.log(l),
    env: process.env,
  }).then((code) => process.exit(code));
}
