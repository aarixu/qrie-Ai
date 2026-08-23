import { describe, expect, it } from 'vitest';
import {
  assetFor,
  binaryNameFor,
  DEFAULT_VERSION_TAG,
  extractCommand,
  normalizeTag,
  parseChecksum,
  unpackByHandHint,
} from '../src/release.ts';

/**
 * The asset names and the checksums-file shape below are copied from the real
 * v1.13.5 release. If LiveKit ever renames an asset, these tests fail here
 * rather than as a 404 on someone's first day.
 */
const REAL_CHECKSUMS = [
  'c020fac437b7cc9b776eef1ad5ea8af77be9acfa07602eca20a3a44930dfbc70  livekit_1.13.5_linux_amd64.tar.gz',
  '332015305518765fe05bad74fc3a9d9583e635e7dd130de3c4fc563d69c550f3  livekit_1.13.5_linux_arm64.tar.gz',
  '6dceb15fec3b2b90a67615acff7f92a48a901408f31c74f3d290a7d4277f76bd  livekit_1.13.5_linux_armv7.tar.gz',
  '3ec7eaa76ef64063bf21f78364733703e0969612cb92ffd60661ed45fa4a8906  livekit_1.13.5_windows_amd64.zip',
  '9a0facddf31346f22854a1beaeaaa2c623c165078c54765115b249d771eb0b66  livekit_1.13.5_windows_arm64.zip',
  '',
].join('\n');

describe('normalizeTag', () => {
  it('accepts a bare version and a tag alike', () => {
    expect(normalizeTag('1.13.5')).toBe('v1.13.5');
    expect(normalizeTag('v1.13.5')).toBe('v1.13.5');
    expect(normalizeTag('  v1.13.5  ')).toBe('v1.13.5');
  });

  it('rejects anything that is not a release tag', () => {
    // "latest" has no filename, because the asset name embeds the version.
    expect(() => normalizeTag('latest')).toThrow(/release tag/);
    expect(() => normalizeTag('v1.13')).toThrow(/release tag/);
    expect(() => normalizeTag('')).toThrow(/release tag/);
  });

  it('ships a pinned default', () => {
    expect(normalizeTag(DEFAULT_VERSION_TAG)).toBe(DEFAULT_VERSION_TAG);
  });
});

describe('assetFor — every platform the release actually carries', () => {
  const cases: [NodeJS.Platform, string, string][] = [
    ['win32', 'x64', 'livekit_1.13.5_windows_amd64.zip'],
    ['win32', 'arm64', 'livekit_1.13.5_windows_arm64.zip'],
    ['linux', 'x64', 'livekit_1.13.5_linux_amd64.tar.gz'],
    ['linux', 'arm64', 'livekit_1.13.5_linux_arm64.tar.gz'],
    ['linux', 'arm', 'livekit_1.13.5_linux_armv7.tar.gz'],
  ];

  it.each(cases)('%s/%s → %s', (platform, arch, assetName) => {
    const asset = assetFor(platform, arch, 'v1.13.5');
    expect(asset.assetName).toBe(assetName);
    // Every name it produces is one the release really publishes.
    expect(parseChecksum(REAL_CHECKSUMS, asset.assetName)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds the download and checksum URLs from the tag', () => {
    const asset = assetFor('win32', 'x64', 'v1.13.5');
    expect(asset.url).toBe(
      'https://github.com/livekit/livekit/releases/download/v1.13.5/livekit_1.13.5_windows_amd64.zip',
    );
    expect(asset.checksumsUrl).toBe(
      'https://github.com/livekit/livekit/releases/download/v1.13.5/checksums.txt',
    );
    expect(asset.version).toBe('1.13.5');
    expect(asset.tag).toBe('v1.13.5');
  });

  it('tracks the version through the whole asset, not just the tag', () => {
    const asset = assetFor('linux', 'x64', 'v1.12.0');
    expect(asset.assetName).toBe('livekit_1.12.0_linux_amd64.tar.gz');
    expect(asset.url).toContain('/download/v1.12.0/');
  });

  it('sends macOS to Homebrew, because the release has no darwin archive', () => {
    expect(() => assetFor('darwin', 'arm64', 'v1.13.5')).toThrow(/brew install livekit/);
  });

  it('names what it does support when the platform is not one of them', () => {
    expect(() => assetFor('linux', 'ia32', 'v1.13.5')).toThrow(/linux\/x64/);
    expect(() => assetFor('freebsd', 'x64', 'v1.13.5')).toThrow(/freebsd\/x64/);
  });
});

describe('binaryNameFor', () => {
  it('is the only place .exe is spelled', () => {
    expect(binaryNameFor('win32')).toBe('livekit-server.exe');
    expect(binaryNameFor('linux')).toBe('livekit-server');
  });
});

describe('parseChecksum', () => {
  it('finds the line for one asset', () => {
    expect(parseChecksum(REAL_CHECKSUMS, 'livekit_1.13.5_windows_amd64.zip')).toBe(
      '3ec7eaa76ef64063bf21f78364733703e0969612cb92ffd60661ed45fa4a8906',
    );
  });

  it('is undefined for an asset the release does not list', () => {
    expect(parseChecksum(REAL_CHECKSUMS, 'livekit_1.13.5_darwin_arm64.tar.gz')).toBeUndefined();
  });

  it('survives CRLF and upper-case digests', () => {
    const text = 'ABCD1234  livekit_9.9.9_linux_amd64.tar.gz\r\n';
    expect(parseChecksum(text, 'livekit_9.9.9_linux_amd64.tar.gz')).toBe('abcd1234');
  });
});

describe('extractCommand', () => {
  it('names the system bsdtar on Windows rather than trusting the PATH', () => {
    // `tar` inside Git Bash is GNU tar, which cannot read a zip at all.
    expect(
      extractCommand({
        platform: 'win32',
        kind: 'zip',
        archiveName: 'a.zip',
        destDir: 'out',
        systemRoot: 'D:\\Windows',
      }),
    ).toEqual({
      command: 'D:\\Windows\\System32\\tar.exe',
      args: ['-xf', 'a.zip'],
      cwd: 'out',
    });
  });

  it('uses the PATH tar everywhere else', () => {
    expect(
      extractCommand({ platform: 'linux', kind: 'tar.gz', archiveName: 'a.tar.gz', destDir: 'out' }),
    ).toEqual({ command: 'tar', args: ['-xzf', 'a.tar.gz'], cwd: 'out' });
  });

  it('passes the archive by basename and unpacks from the destination', () => {
    // A drive letter in an argument makes GNU tar try to open an SSH connection
    // to a host called "C" — the observed failure was "Cannot connect to C:".
    const cmd = extractCommand({
      platform: 'win32',
      kind: 'zip',
      archiveName: 'livekit_1.13.5_windows_amd64.zip',
      destDir: 'C:\\repo\\bin',
    });
    expect(cmd.args.some((a) => a.includes(':'))).toBe(false);
    expect(cmd.cwd).toBe('C:\\repo\\bin');
  });

  it('has a by-hand fallback per kind', () => {
    expect(unpackByHandHint('zip', 'a.zip', 'out')).toContain('Expand-Archive');
    expect(unpackByHandHint('tar.gz', 'a.tar.gz', 'out')).toContain('tar -xzf');
  });
});
