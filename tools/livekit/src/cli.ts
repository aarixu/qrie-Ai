import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBinary, httpGet, spawnCommand } from './install.ts';
import { assetFor, DEFAULT_VERSION_TAG, normalizeTag, RELEASES_PAGE } from './release.ts';
import { banner, planLaunch, runServer } from './server.ts';

/**
 * The local LiveKit server, in one command.
 *
 *   npm run livekit:server
 *
 * CLI only — thin on purpose. Everything worth testing lives in the modules
 * beside it: which asset this platform needs (release.ts), whether it is
 * already here (install.ts), and what flags the server gets (server.ts).
 */

/** Downloaded builds land here, one directory per tag. Gitignored; never committed. */
const BIN_ROOT = fileURLToPath(new URL('../bin/', import.meta.url));

/** The config this tool ships, resolved from the module so cwd does not matter. */
const SHIPPED_CONFIG = fileURLToPath(new URL('../livekit.yaml', import.meta.url));

const VALUE_FLAGS = new Set(['--config', '--version']);
const BOOL_FLAGS = new Set(['--dev', '--download-only', '--force', '--help', '-h']);

const HELP = `Usage:
  node tools/livekit/src/cli.ts [options]

  (no options)      run the shipped config: tools/livekit/livekit.yaml
  --dev             ignore config files entirely and run livekit-server --dev
  --config <path>   run this config instead of the shipped one
  --version <tag>   server release to use (default ${DEFAULT_VERSION_TAG})
  --force           re-download this version even if it is already unpacked
  --download-only   download, verify and unpack; do not start anything

The binary is downloaded from ${RELEASES_PAGE} on first run, checked against the
release's own sha256, and unpacked into tools/livekit/bin/<tag>/.`;

function usage(message: string): never {
  console.error(`${message}

${HELP}`);
  process.exit(2);
}

function readConfigOrExit(configPath: string): string {
  try {
    return fs.readFileSync(configPath, 'utf8');
  } catch {
    return usage(`No config file at ${configPath}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (VALUE_FLAGS.has(arg)) i += 1;
    else if (!BOOL_FLAGS.has(arg)) usage(`Unknown option "${arg}".`);
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  const dev = argv.includes('--dev');
  const configArg = flag('--config');
  if (dev && configArg !== undefined) {
    usage('--dev ignores config files. Pass one or the other, not both.');
  }

  // Resolved and read BEFORE anything is downloaded: a typo in --config should
  // not cost 17 MB and a minute to report.
  const configPath = configArg === undefined ? SHIPPED_CONFIG : path.resolve(process.cwd(), configArg);
  const config = dev ? null : { path: configPath, text: readConfigOrExit(configPath) };

  const tag = normalizeTag(flag('--version') ?? DEFAULT_VERSION_TAG);
  const asset = assetFor(process.platform, process.arch, tag);

  const { binary, decision } = await ensureBinary({
    root: BIN_ROOT,
    asset,
    force: argv.includes('--force'),
    http: httpGet,
    run: spawnCommand,
    log: (line) => console.log(line),
  });

  if (argv.includes('--download-only')) {
    console.log(`${decision === 'use-existing' ? 'Already unpacked' : 'Unpacked'}: ${binary}`);
    return;
  }

  const plan = planLaunch({
    config,
    // LIVEKIT_KEYS beats the config file, so the banner must not claim dev keys
    // when a real pair is sitting in the environment.
    keysInEnv: (process.env.LIVEKIT_KEYS ?? '').trim().length > 0,
  });

  console.log(banner({ plan, binary, tag, platform: process.platform }));
  runServer(binary, plan.args);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  // exitCode rather than exit(): a fetch that has just finished still holds a
  // socket, and killing the process out from under libuv on Windows turns a
  // clean error message into an assertion failure underneath it.
  process.exitCode = 1;
});
