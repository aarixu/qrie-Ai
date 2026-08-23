import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureBinary,
  installDecision,
  installPaths,
  type HttpGet,
  type RunCommand,
} from '../src/install.ts';
import { assetFor, type ReleaseAsset } from '../src/release.ts';

const asset = (): ReleaseAsset => assetFor('win32', 'x64', 'v1.13.5');

const dirs: string[] = [];
const tmpDir = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lkserver-'));
  dirs.push(d);
  return d;
};

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const ARCHIVE = new TextEncoder().encode('pretend this is 54 MB of zip');
const DIGEST = createHash('sha256').update(ARCHIVE).digest('hex');

/** Serves whatever the test hands it; anything else is a 404, like the real thing. */
const fakeHttp = (files: Record<string, Uint8Array>): HttpGet & { urls: string[] } => {
  const urls: string[] = [];
  const get: HttpGet = async (url) => {
    urls.push(url);
    const body = files[url];
    return body
      ? { ok: true, status: 200, statusText: 'OK', body }
      : { ok: false, status: 404, statusText: 'Not Found', body: new Uint8Array() };
  };
  return Object.assign(get, { urls });
};

/** Stands in for tar: drops the binary where a real unpack would put it. */
const fakeTar = (binaryName: string): RunCommand & { calls: string[][] } => {
  const calls: string[][] = [];
  const run: RunCommand = async (command, args, options) => {
    calls.push([command, ...args]);
    fs.writeFileSync(path.join(options.cwd, binaryName), 'MZ');
    return { code: 0, stderr: '' };
  };
  return Object.assign(run, { calls });
};

const served = (a: ReleaseAsset): Record<string, Uint8Array> => ({
  [a.checksumsUrl]: new TextEncoder().encode(`${DIGEST}  ${a.assetName}\n`),
  [a.url]: ARCHIVE,
});

describe('installPaths', () => {
  it('keeps one directory per release tag', () => {
    const a = asset();
    const paths = installPaths(path.join('root', 'bin'), a);
    expect(paths.dir).toBe(path.join('root', 'bin', 'v1.13.5'));
    expect(paths.binary).toBe(path.join('root', 'bin', 'v1.13.5', 'livekit-server.exe'));
    expect(paths.archive).toBe(path.join('root', 'bin', 'v1.13.5', a.assetName));
  });

  it('gives two versions two directories, so --version never overwrites', () => {
    const root = path.join('root', 'bin');
    expect(installPaths(root, assetFor('linux', 'x64', 'v1.13.5')).dir).not.toBe(
      installPaths(root, assetFor('linux', 'x64', 'v1.12.0')).dir,
    );
  });
});

describe('installDecision', () => {
  it('skips the network when the binary for this tag is already unpacked', () => {
    expect(installDecision(true, false)).toBe('use-existing');
  });

  it('downloads when it is not there', () => {
    expect(installDecision(false, false)).toBe('download');
  });

  it('downloads anyway under --force', () => {
    expect(installDecision(true, true)).toBe('download');
    expect(installDecision(false, true)).toBe('download');
  });
});

describe('ensureBinary', () => {
  const log = (): string[] => [];

  it('downloads, verifies and unpacks on a cold machine', async () => {
    const a = asset();
    const root = tmpDir();
    const http = fakeHttp(served(a));
    const run = fakeTar(a.binaryName);
    const lines = log();

    const result = await ensureBinary({ root, asset: a, force: false, http, run, log: (l) => lines.push(l) });

    expect(result.decision).toBe('download');
    expect(fs.existsSync(result.binary)).toBe(true);
    // Checksums first: a bad --version must fail before 54 MB, not after it.
    expect(http.urls).toEqual([a.checksumsUrl, a.url]);
    expect(run.calls[0]?.[0]).toMatch(/tar(\.exe)?$/);
    expect(lines.join('\n')).toContain('Verified sha256');
  });

  it('does not touch the network when the binary is already there', async () => {
    const a = asset();
    const root = tmpDir();
    const paths = installPaths(root, a);
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.binary, 'MZ');

    const http = fakeHttp({});
    const result = await ensureBinary({
      root,
      asset: a,
      force: false,
      http,
      run: fakeTar(a.binaryName),
      log: () => {},
    });

    expect(result.decision).toBe('use-existing');
    expect(result.binary).toBe(paths.binary);
    expect(http.urls).toEqual([]);
  });

  it('re-downloads under --force even though the binary is there', async () => {
    const a = asset();
    const root = tmpDir();
    const paths = installPaths(root, a);
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.binary, 'stale');

    const http = fakeHttp(served(a));
    await ensureBinary({ root, asset: a, force: true, http, run: fakeTar(a.binaryName), log: () => {} });

    expect(http.urls).toContain(a.url);
    expect(fs.readFileSync(paths.binary, 'utf8')).toBe('MZ');
  });

  it('writes nothing when the bytes do not match the release checksum', async () => {
    const a = asset();
    const root = tmpDir();
    const http = fakeHttp({
      [a.checksumsUrl]: new TextEncoder().encode(`${'0'.repeat(64)}  ${a.assetName}\n`),
      [a.url]: ARCHIVE,
    });

    await expect(
      ensureBinary({ root, asset: a, force: false, http, run: fakeTar(a.binaryName), log: () => {} }),
    ).rejects.toThrow(/Checksum mismatch/);
    expect(fs.existsSync(installPaths(root, a).dir)).toBe(false);
  });

  it('names the tag when the release does not exist at all', async () => {
    const a = assetFor('win32', 'x64', 'v9.9.9');
    const root = tmpDir();

    await expect(
      ensureBinary({
        root,
        asset: a,
        force: false,
        http: fakeHttp({}),
        run: fakeTar(a.binaryName),
        log: () => {},
      }),
    ).rejects.toThrow(/no LiveKit release v9.9.9/);
  });

  it('says the tag is wrong when the release lists no such asset', async () => {
    const a = asset();
    const root = tmpDir();
    const http = fakeHttp({
      [a.checksumsUrl]: new TextEncoder().encode('deadbeef  livekit_1.13.5_linux_amd64.tar.gz\n'),
      [a.url]: ARCHIVE,
    });

    await expect(
      ensureBinary({ root, asset: a, force: false, http, run: fakeTar(a.binaryName), log: () => {} }),
    ).rejects.toThrow(/lists no livekit_1.13.5_windows_amd64.zip/);
  });

  it('reports a missing unpacker with the command to run by hand', async () => {
    const a = asset();
    const root = tmpDir();
    const noTar: RunCommand = async () => ({ code: null, stderr: 'spawn tar.exe ENOENT' });

    await expect(
      ensureBinary({ root, asset: a, force: false, http: fakeHttp(served(a)), run: noTar, log: () => {} }),
    ).rejects.toThrow(/Expand-Archive/);
  });

  it('refuses an archive that unpacked without the server in it', async () => {
    const a = asset();
    const root = tmpDir();
    const emptyUnpack: RunCommand = async () => ({ code: 0, stderr: '' });

    await expect(
      ensureBinary({ root, asset: a, force: false, http: fakeHttp(served(a)), run: emptyUnpack, log: () => {} }),
    ).rejects.toThrow(/release layout changed/);
  });
});
