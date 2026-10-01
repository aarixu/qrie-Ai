/**
 * WHAT THE RUNNER REMEMBERS BETWEEN RUNS — so a re-run RESUMES instead of
 * RE-PAYS.
 *
 * One JSON file per syllabus under tools/prewarm/state/. Every topic the
 * runner has touched gets a row: `done` (prepared and kept — never touched
 * again, that would be paying twice for one recording), `skipped` (found
 * already kept on the live project, or filtered out on purpose), or `failed`
 * (money may have been spent and nothing was kept — retried on the next run,
 * because a failure is the one thing a resume exists to come back for).
 *
 * The file is written atomically (tmp + rename) so a run killed mid-write
 * cannot leave half a JSON behind — and if it somehow does, `loadState`
 * THROWS rather than starting fresh. A corrupt state file read as "empty"
 * would quietly re-prepare the whole catalogue, which at Rs 30 a topic is a
 * four-figure bill for a parse error.
 */
import fs from 'node:fs';
import path from 'node:path';

export const STATUSES = ['done', 'failed', 'skipped'];

/**
 * Three consecutive failures stop the run. One failure is a model having a
 * moment; three in a row is a broken prompt or a dead relay, and a broken
 * prompt must not burn the catalogue budget one topic at a time.
 */
export const MAX_CONSECUTIVE_FAILURES = 3;

export const shouldStop = (consecutiveFailures) =>
  consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;

export const emptyState = (syllabus) => ({ syllabus, topics: {} });

export const statePath = (dir, syllabus) => path.join(dir, `${syllabus}.json`);

/**
 * Record one topic's outcome. Mutates and returns the state — the runner
 * saves after every topic, so a crash loses at most the topic in flight.
 */
export function markTopic(state, topicRef, note) {
  if (!STATUSES.includes(note.status)) {
    throw new Error(
      `state: unknown status "${note.status}" for ${topicRef} — one of ${STATUSES.join('/')}`,
    );
  }
  state.topics[topicRef] = { ...note, at: note.at ?? new Date().toISOString() };
  return state;
}

/**
 * Which of these topics still need paying for. `done` and `skipped` never
 * come back; `failed` and never-tried do. Order is the caller's order, so a
 * resume walks the syllabus in the same sequence the first run did.
 */
export function pendingTopics(state, refs) {
  return refs.filter((ref) => {
    const seen = state.topics[ref];
    return seen === undefined || seen.status === 'failed';
  });
}

export function loadState(dir, syllabus) {
  const file = statePath(dir, syllabus);
  if (!fs.existsSync(file)) return emptyState(syllabus);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(
      `state file for ${syllabus} is corrupt (${file}): ${e instanceof Error ? e.message : e}. ` +
        `Refusing to treat it as empty — that would re-pay every topic in it. ` +
        `Fix or delete the file deliberately.`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.topics !== 'object') {
    throw new Error(
      `state file for ${syllabus} (${file}) is not the expected shape. ` +
        `Refusing to treat it as empty — fix or delete it deliberately.`,
    );
  }
  return parsed;
}

export function saveState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  const file = statePath(dir, state.syllabus);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * A CLASS REFUSED AT THE END IS KEPT HERE, PAID FOR, FOR `--rekeep`.
 *
 * By the time the keep refuses a class at the end, its plan, its review and
 * every picture are already bought. Thrown away, a fix to the layout engine
 * means buying them all again; written here — the prepared class with what it
 * was laid out from (`replay`) and the meta it would be kept under — a later
 * `--rekeep` lays it out again with the fixed engine and keeps it without a
 * single model call for the class itself (canvas C0, item 2). One file per
 * topic, named for its path, written atomically like the state file.
 */
export const refusedDir = (dir, syllabus) => path.join(dir, 'refused', syllabus);
export const refusedPath = (dir, syllabus, topicRef) =>
  path.join(refusedDir(dir, syllabus), `${topicRef.replace(/[^A-Za-z0-9._-]+/g, '__')}.json`);

export function saveRefused(dir, syllabus, topicRef, record) {
  const file = refusedPath(dir, syllabus, topicRef);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ topicRef, savedAt: new Date().toISOString(), ...record }), 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

/** The refused record for this topic, or null when there is none. */
export function loadRefused(dir, syllabus, topicRef) {
  const file = refusedPath(dir, syllabus, topicRef);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function dropRefused(dir, syllabus, topicRef) {
  fs.rmSync(refusedPath(dir, syllabus, topicRef), { force: true });
}

/**
 * ONE RUN AT A TIME PER SYLLABUS.
 *
 * The writes above are atomic, which stops a torn file — it does not stop two
 * runs. Two terminals (or a cron re-firing while the first is still going)
 * both load the state file before either saves, so both see the same pending
 * set and both prepare, and pay for, every topic in it. The `wx` flag is the
 * whole mechanism: creating the lock file IS the test, so there is no window
 * between checking and taking.
 *
 * A crashed run leaves its lock behind. That is deliberate — the alternative
 * is guessing whether a pid is alive, and guessing wrong costs a catalogue.
 * The refusal names the pid so the operator can decide, and `--force` is how
 * they say it is dead.
 */
export function acquireStateLock(dir, syllabus, { force = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${syllabus}.lock`);
  const mine = JSON.stringify({ pid: process.pid, since: new Date().toISOString() });
  try {
    fs.writeFileSync(file, mine, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e;
    if (!force) {
      let held = '';
      try {
        held = ` (held by pid ${JSON.parse(fs.readFileSync(file, 'utf8')).pid})`;
      } catch {
        held = '';
      }
      throw new Error(
        `a pre-warm run is already running against ${syllabus}${held}. Two runs would prepare ` +
          `and pay for the same topics. If that run is dead, re-run with --force.`,
      );
    }
    fs.writeFileSync(file, mine, 'utf8');
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // A lock we cannot remove is a nuisance, not a reason to fail a run that
      // has already done its work — the message above tells the next run what
      // to do about it.
    }
  };
}
