import path from 'node:path';

/**
 * WHICH FILE TO DOWNLOAD, AND FROM WHERE.
 *
 * Pure: no fs, no network, no process. Everything here is a decision that can
 * be wrong on a machine none of us owns — a Linux deploy box, an ARM laptop —
 * so it is a table and a few string functions, all unit-tested, rather than
 * platform `if`s scattered through the CLI.
 */

/**
 * Pinned, not "latest", for two reasons. The asset filename embeds the version
 * number, so "latest" cannot even be turned into a URL without an extra API
 * call — and a version that moves under a new developer is the opposite of a
 * repeatable first day. This is the build verified on Windows 11 for this repo.
 * Bump it deliberately: `--version v1.13.6` first, then change this line.
 */
export const DEFAULT_VERSION_TAG = 'v1.13.5';

const RELEASE_BASE = 'https://github.com/livekit/livekit/releases/download';

/** One checksums file per release, listing every asset. Same name every time. */
const CHECKSUMS_FILE = 'checksums.txt';

export const RELEASES_PAGE = 'https://github.com/livekit/livekit/releases';

export type ArchiveKind = 'zip' | 'tar.gz';

interface PlatformAsset {
  platform: NodeJS.Platform;
  /** Node's `process.arch`, not Go's GOARCH — the slug carries the Go name. */
  arch: string;
  slug: string;
  kind: ArchiveKind;
}

/**
 * The real asset matrix, read off the v1.13.5 release and confirmed identical
 * back through v1.12.0. Note what is NOT here: there is no darwin archive at
 * all. LiveKit ships macOS through Homebrew only, which is why `assetFor`
 * answers darwin with instructions instead of a URL.
 */
const ASSETS: readonly PlatformAsset[] = [
  { platform: 'win32', arch: 'x64', slug: 'windows_amd64', kind: 'zip' },
  { platform: 'win32', arch: 'arm64', slug: 'windows_arm64', kind: 'zip' },
  { platform: 'linux', arch: 'x64', slug: 'linux_amd64', kind: 'tar.gz' },
  { platform: 'linux', arch: 'arm64', slug: 'linux_arm64', kind: 'tar.gz' },
  { platform: 'linux', arch: 'arm', slug: 'linux_armv7', kind: 'tar.gz' },
];

export interface ReleaseAsset {
  /** The machine this build is for — the asset alone should say so. */
  platform: NodeJS.Platform;
  /** Git tag, always with the leading v: "v1.13.5". */
  tag: string;
  /** Bare version as it appears inside the filename: "1.13.5". */
  version: string;
  assetName: string;
  url: string;
  checksumsUrl: string;
  /** What the archive unpacks to, at its root, next to LICENSE. */
  binaryName: string;
  kind: ArchiveKind;
}

/** Accepts "1.13.5" or "v1.13.5"; anything else is a typo worth catching early. */
export function normalizeTag(input: string): string {
  const tag = input.trim().startsWith('v') ? input.trim() : `v${input.trim()}`;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(
      `"${input}" is not a LiveKit release tag. Expected something like v1.13.5 — see ${RELEASES_PAGE}`,
    );
  }
  return tag;
}

export function binaryNameFor(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'livekit-server.exe' : 'livekit-server';
}

export function assetFor(platform: NodeJS.Platform, arch: string, tag: string): ReleaseAsset {
  if (platform === 'darwin') {
    throw new Error(
      'LiveKit publishes no macOS binary in its GitHub releases — it ships mac through Homebrew.\n' +
        '  brew install livekit\n' +
        'then run the server yourself with the same config:\n' +
        '  livekit-server --config tools/livekit/livekit.yaml --dev',
    );
  }

  const match = ASSETS.find((a) => a.platform === platform && a.arch === arch);
  if (!match) {
    const supported = ASSETS.map((a) => `${a.platform}/${a.arch}`).join(', ');
    throw new Error(
      `No livekit-server build for ${platform}/${arch}. The release carries: ${supported}.`,
    );
  }

  const version = tag.slice(1);
  const assetName = `livekit_${version}_${match.slug}.${match.kind}`;

  return {
    platform,
    tag,
    version,
    assetName,
    url: `${RELEASE_BASE}/${tag}/${assetName}`,
    checksumsUrl: `${RELEASE_BASE}/${tag}/${CHECKSUMS_FILE}`,
    binaryName: binaryNameFor(platform),
    kind: match.kind,
  };
}

/**
 * checksums.txt is `<sha256>  <filename>` per line. Returning undefined for a
 * name that is not listed is the signal that the tag is real but the asset is
 * not — which is how a bad --version on an exotic platform actually surfaces.
 */
export function parseChecksum(text: string, assetName: string): string | undefined {
  for (const line of text.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === assetName && hash) return hash.toLowerCase();
  }
  return undefined;
}

export interface Command {
  command: string;
  args: string[];
  /** The unpacker runs from here — see the colon note below. */
  cwd: string;
}

/** Where Windows keeps bsdtar. Overridable because %SystemRoot% is not always C:. */
const DEFAULT_SYSTEM_ROOT = 'C:\\Windows';

export interface ExtractRequest {
  platform: NodeJS.Platform;
  kind: ArchiveKind;
  /** Basename only, not a path. */
  archiveName: string;
  destDir: string;
  /** process.env.SystemRoot, passed in so this module stays pure. */
  systemRoot?: string;
}

/**
 * Unpacking, with the two Windows traps already paid for.
 *
 * FIRST: `tar` on the PATH is not one program. Windows 10 1803+ ships bsdtar at
 * System32\tar.exe, which reads zip — but Git for Windows puts its own GNU tar
 * ahead of it on the PATH inside Git Bash, and GNU tar cannot read a zip at all.
 * So on Windows the system bsdtar is named by absolute path, not by hope.
 *
 * SECOND: GNU tar reads an argument containing a colon as host:path and tries to
 * open a network connection — "Cannot connect to C: resolve failed". Running
 * from the destination directory and naming the archive by basename means no
 * argument ever contains a drive letter, on either tar.
 */
export function extractCommand(req: ExtractRequest): Command {
  const args = [req.kind === 'zip' ? '-xf' : '-xzf', req.archiveName];

  if (req.platform === 'win32') {
    const root = req.systemRoot ?? DEFAULT_SYSTEM_ROOT;
    return { command: path.win32.join(root, 'System32', 'tar.exe'), args, cwd: req.destDir };
  }

  return { command: 'tar', args, cwd: req.destDir };
}

/** What to tell someone whose unpacker is missing or refuses the archive. */
export function unpackByHandHint(kind: ArchiveKind, archive: string, destDir: string): string {
  return kind === 'zip'
    ? `Expand-Archive -Path "${archive}" -DestinationPath "${destDir}"`
    : `tar -xzf "${archive}" -C "${destDir}"`;
}
