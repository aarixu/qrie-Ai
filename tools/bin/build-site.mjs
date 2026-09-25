/**
 * BUILD THE WHOLE SITE: the marketing pages and the classroom, on one origin.
 *
 * Why one origin, since this script exists entirely to arrange it: a Supabase
 * session lives in localStorage, and localStorage is per-origin. The contest
 * form signs a visitor in anonymously and writes `contest_signup.user_id`; if
 * the classroom then loads from a different hostname it finds no session,
 * signs in anonymously AGAIN, and the child who entered the contest and the
 * child who took the class are two different rows that can never be joined.
 * Nobody finds out until somebody tries to ring a winner.
 *
 *   node tools/bin/build-site.mjs
 *
 * Produces landing/.next plus landing/public/app — deploy `landing/`.
 *
 * The classroom is built with VITE_BASE=/app/, which is the one flag that
 * moves the router basename, the lesson catalogue, the audio URLs, the service
 * worker scope and the reload guard together. Building it any other way and
 * copying it here produces a blank page: index.html would ask for
 * /assets/index-*.js, the marketing site has no such file, and the SPA rewrite
 * would hand back HTML with a JavaScript content type.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const run = (cmd, args, extraEnv = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, {
    cwd: repo,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
};

run('npm', ['run', 'build'], { VITE_BASE: '/app/' });

// The scan is not optional and not a separate step somebody might skip. This
// build puts the classroom bundle inside a Next.js project whose own build
// then copies it again, so a key that leaked into it would be published twice.
run('node', ['tools/bin/check-bundle-secrets.mjs']);

const from = fileURLToPath(new URL('../../apps/classroom/dist', import.meta.url));
const to = fileURLToPath(new URL('../../landing/public/app', import.meta.url));

// Removed rather than merged: a hashed asset from a previous build that no
// index.html references is dead weight, and a lesson folder deleted from
// content/ would otherwise stay served forever.
if (existsSync(to)) rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log(`\n  classroom -> landing/public/app`);

run('npm', ['--prefix', 'landing', 'run', 'build']);

console.log('\n  Done. Deploy the `landing` directory.');
