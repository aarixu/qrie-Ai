import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractCommand,
  parseChecksum,
  RELEASES_PAGE,
  unpackByHandHint,
  type ReleaseAsset,
} from './release.ts';

/**
 * GETTING THE BINARY ONTO THIS MACHINE, ONCE.
 *
 * Download, verify, unpack — in that order, and the order is the point: the
 * archive bytes are checked against the release's own checksums file before
 * anything is written to disk, so an unverified executable never exists as a
 * file for someone to run by accident.
 *
 * The network and the unpacker are both injected, which is what lets the tests
 * exercise the real verification path without touching either.
 */

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  body: Uint8Array;
}

export type HttpGet = (url: string) => Promise<HttpResponse>;

export const httpGet: HttpGet = async (url) => {
  // GitHub release downloads redirect to their CDN; fetch follows by default.
  const res = await fetch(url);
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    body: new Uint8Array(await res.arrayBuffer()),
  };
};

export interface CommandResult {
  code: number | null;
  stderr: string;
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
) => Promise<CommandResult>;

export const spawnCommand: RunCommand = (command, args, options) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd: options.cwd, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    // A missing binary arrives as an 'error' event, not a non-zero exit.
    child.on('error', (e: Error) => resolve({ code: null, stderr: e.message }));
    child.on('close', (code) => resolve({ code, stderr }));
  });

export type Logger = (line: string) => void;

export interface InstallPaths {
  /** One directory per release tag, so --version switches cleanly. */
  dir: string;
  binary: string;
  archive: string;
}

export function installPaths(root: string, asset: ReleaseAsset): InstallPaths {
  const dir = path.join(root, asset.tag);
  return {
    dir,
    binary: path.join(dir, asset.binaryName),
    archive: path.join(dir, asset.assetName),
  };
}

export type InstallDecision = 'use-existing' | 'download';

/**
 * The whole "do I need the network today" question. Because the install
 * directory is named after the tag, an existing binary is necessarily the
 * right version — there is no staleness to reason about, only presence.
 */
export function installDecision(binaryExists: boolean, force: boolean): InstallDecision {
  if (force) return 'download';
  return binaryExists ? 'use-existing' : 'download';
}

export interface EnsureBinaryOptions {
  /** Directory that holds one subdirectory per release. Gitignored. */
  root: string;
  asset: ReleaseAsset;
  force: boolean;
  http: HttpGet;
  run: RunCommand;
  log: Logger;
}

export interface EnsureBinaryResult {
  binary: string;
  decision: InstallDecision;
}

const megabytes = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} MB`;

export async function ensureBinary(opts: EnsureBinaryOptions): Promise<EnsureBinaryResult> {
  const { root, asset, force, http, run, log } = opts;
  const paths = installPaths(root, asset);

  const decision = installDecision(fs.existsSync(paths.binary), force);
  if (decision === 'use-existing') {
    return { binary: paths.binary, decision };
  }

  // Checksums first: it is a few hundred bytes, and it is what fails fast and
  // clearly when someone passes a --version tag that does not exist. Finding
  // that out after 17 MB of download would be the same information, later.
  log(`Fetching ${asset.checksumsUrl}`);
  const checksumsRes = await http(asset.checksumsUrl);
  if (checksumsRes.status === 404) {
    // The tag is the only part of that URL we invented, so this is what a typo
    // in --version looks like from here.
    throw new Error(`There is no LiveKit release ${asset.tag}. See ${RELEASES_PAGE}`);
  }
  if (!checksumsRes.ok) {
    throw new Error(`GET ${asset.checksumsUrl} → ${checksumsRes.status} ${checksumsRes.statusText}`);
  }
  const checksums = new TextDecoder().decode(checksumsRes.body);
  const expected = parseChecksum(checksums, asset.assetName);
  if (!expected) {
    throw new Error(
      `Release ${asset.tag} exists but lists no ${asset.assetName}. Check the tag and the platform.`,
    );
  }

  log(`Downloading ${asset.assetName} from ${asset.url}`);
  const archiveRes = await http(asset.url);
  if (!archiveRes.ok) {
    throw new Error(`GET ${asset.url} → ${archiveRes.status} ${archiveRes.statusText}`);
  }
  const archive = archiveRes.body;

  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${asset.assetName}.\n  expected ${expected}\n  got      ${actual}\n` +
        'Nothing was written. Re-run; if it repeats, do not run the file.',
    );
  }
  log(`Verified sha256 ${actual.slice(0, 16)}… (${megabytes(archive.length)})`);

  // A previous run that died mid-unpack leaves a half-populated directory, and
  // the cheapest way to be sure of what is in there is to start it empty.
  fs.rmSync(paths.dir, { recursive: true, force: true });
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.archive, archive);

  const cmd = extractCommand({
    platform: asset.platform,
    kind: asset.kind,
    archiveName: asset.assetName,
    destDir: paths.dir,
    systemRoot: process.env.SystemRoot,
  });
  const result = await run(cmd.command, cmd.args, { cwd: cmd.cwd });
  if (result.code !== 0) {
    throw new Error(
      `Could not unpack ${asset.assetName}: ${cmd.command} exited ${result.code ?? 'without running'}` +
        `${result.stderr.trim() ? ` — ${result.stderr.trim().slice(0, 300)}` : ''}\n` +
        `Unpack it by hand and re-run:\n  ${unpackByHandHint(asset.kind, paths.archive, paths.dir)}`,
    );
  }
  if (!fs.existsSync(paths.binary)) {
    throw new Error(
      `${asset.assetName} unpacked without a ${asset.binaryName} at its root. The release layout changed.`,
    );
  }

  // The archive has already become the only artefact that matters. Keeping it
  // would leave 17 MB of duplicate bytes behind for every version pinned.
  fs.rmSync(paths.archive, { force: true });

  return { binary: paths.binary, decision };
}
