import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PcmFormat } from './audio.ts';

/**
 * PCM in, a file a phone can play out.
 *
 * AAC in m4a is the shipping format because it decodes everywhere, iOS Safari
 * included. Opus is smaller but is not universally decodable through Web Audio
 * decodeAudioData, and a class that is silent on one browser is not a class.
 * 32 kbps mono is transparent for a single speaking voice and turned 349 KB of
 * measured PCM into 31 KB.
 */

export interface CommandResult {
  code: number | null;
  stderr: string;
}

/** Injected everywhere, so tests never touch a real binary. */
export type RunCommand = (command: string, args: readonly string[]) => Promise<CommandResult>;

export const FFMPEG_INSTALL_HINT = 'winget install --id Gyan.FFmpeg -e';

export const AAC_BITRATE_KBPS = 32;

export const spawnCommand: RunCommand = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    // A missing binary arrives as an 'error' event, not a non-zero exit.
    child.on('error', (e: Error) => resolve({ code: null, stderr: e.message }));
    child.on('close', (code) => resolve({ code, stderr }));
  });

export async function hasFfmpeg(run: RunCommand = spawnCommand): Promise<boolean> {
  const result = await run('ffmpeg', ['-version']);
  return result.code === 0;
}

export function ffmpegArgs(pcmFile: string, format: PcmFormat, outFile: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    // Raw PCM carries no header, so the format has to be declared on the input.
    '-f',
    's16le',
    '-ar',
    String(format.sampleRate),
    '-ac',
    String(format.channels),
    '-i',
    pcmFile,
    '-c:a',
    'aac',
    '-b:a',
    `${AAC_BITRATE_KBPS}k`,
    outFile,
  ];
}

export interface EncodeRequest {
  pcm: Buffer;
  format: PcmFormat;
  /** Absolute path of the .m4a to write. */
  outFile: string;
}

export interface AudioEncoder {
  /** Returns the size of the written file in bytes. */
  encode(request: EncodeRequest): Promise<number>;
}

export function createFfmpegEncoder(run: RunCommand = spawnCommand): AudioEncoder {
  return {
    async encode({ pcm, format, outFile }: EncodeRequest): Promise<number> {
      // ffmpeg reads the raw PCM from a file rather than stdin: piping megabytes
      // into a child process is where this would break on Windows, and a temp
      // file costs nothing at authoring time.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-class-'));
      const pcmFile = path.join(dir, 'take.pcm');
      try {
        fs.writeFileSync(pcmFile, pcm);
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        const result = await run('ffmpeg', ffmpegArgs(pcmFile, format, outFile));
        if (result.code !== 0) {
          throw new Error(`ffmpeg exited ${result.code ?? 'without running'}: ${result.stderr.trim().slice(0, 300)}`);
        }
        return fs.statSync(outFile).size;
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
