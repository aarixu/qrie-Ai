import { spawn } from 'node:child_process';
import { DEV_PORTS, hasKeys, readPorts, websocketUrl, type Ports } from './config.ts';

/**
 * HOW THE SERVER IS STARTED, AND WHAT IS SAID BEFORE IT IS.
 *
 * `planLaunch` is the only place that decides anything, and it is pure. The
 * banner is a string function for the same reason: the lines a newcomer reads
 * on their first run are worth a test, because they are the documentation that
 * is actually in front of them at the moment it matters.
 */

/** Dev credentials livekit-server injects itself. Not a secret — they are in its source. */
export const DEV_API_KEY = 'devkey';
export const DEV_API_SECRET = 'secret';

export interface LaunchInput {
  /** null means the zero-config path: `livekit-server --dev`, no file involved. */
  config: { path: string; text: string } | null;
  /** LIVEKIT_KEYS is set in the environment, which beats anything in the file. */
  keysInEnv: boolean;
}

export interface LaunchPlan {
  args: string[];
  ports: Ports;
  configPath: string | null;
  /** livekit-server will inject devkey/secret because nothing else supplied keys. */
  devKeys: boolean;
}

/**
 * `--dev` is not a mode switch, whatever its name suggests: it turns on debug
 * logging and pprof, and it injects devkey/secret ONLY when no keys were
 * configured. That is why it can be added on top of our own config file — the
 * committed config carries no secret, so this is what makes the first run work
 * at all, and the moment someone adds real keys the same flag stops mattering.
 */
export function planLaunch({ config, keysInEnv }: LaunchInput): LaunchPlan {
  if (!config) {
    return { args: ['--dev'], ports: DEV_PORTS, configPath: null, devKeys: true };
  }

  const devKeys = !hasKeys(config.text) && !keysInEnv;
  const args = ['--config', config.path];
  if (devKeys) args.push('--dev');

  return { args, ports: readPorts(config.text), configPath: config.path, devKeys };
}

const RULE = '─'.repeat(64);

function portLines(ports: Ports): string[] {
  return [
    `  TCP ${ports.signal}  signalling + REST — the browser AND the agent worker use this one`,
    `  TCP ${ports.iceTcp}  ICE/TCP, the fallback for networks that block UDP`,
    ports.iceUdp === null
      ? '  UDP 50000-60000  media — 10,001 ports, because this config sets no rtc.udp_port'
      : `  UDP ${ports.iceUdp}  media, all of it, on this one mux port`,
  ];
}

export interface BannerInput {
  plan: LaunchPlan;
  binary: string;
  tag: string;
  platform: NodeJS.Platform;
}

export function banner({ plan, binary, tag, platform }: BannerInput): string {
  const lines = [
    RULE,
    `livekit-server ${tag}`,
    `  binary  ${binary}`,
    `  config  ${plan.configPath ?? 'none (--dev: livekit-server\'s own defaults)'}`,
    plan.devKeys
      ? '  keys    development keys, injected by --dev. Debug logging comes with them.'
      : '  keys    from your config — not the development keys.',
    '',
    'Ports:',
    ...portLines(plan.ports),
    '',
    'Point the app and the agent at:',
    `  LIVEKIT_URL=${websocketUrl(plan.ports.signal)}`,
  ];

  if (plan.devKeys) {
    lines.push(`  LIVEKIT_API_KEY=${DEV_API_KEY}`, `  LIVEKIT_API_SECRET=${DEV_API_SECRET}`);
  }

  if (platform === 'win32') {
    lines.push(
      '',
      'First run: Windows Defender will ask about livekit-server.exe. That dialog is',
      'expected, not a hang — tick "Private networks", leave "Public networks" off.',
      'Dismiss it and signalling still connects while audio silently never does.',
    );
  }

  lines.push(RULE, '');
  return lines.join('\n');
}

/**
 * Hand the terminal over. stdio is inherited so the server's own logs are the
 * only thing on screen from here on, and SIGINT is deliberately ignored in this
 * process: Ctrl-C reaches the child through the shared console anyway, and
 * racing it to exit would throw away the child's shutdown and its exit code.
 */
export function runServer(binary: string, args: readonly string[]): void {
  const child = spawn(binary, [...args], { stdio: 'inherit', windowsHide: true });

  process.on('SIGINT', () => {});

  child.on('error', (e: Error) => {
    console.error(`Could not start ${binary}: ${e.message}`);
    process.exitCode = 1;
  });
  // The server's exit code is this command's exit code, set rather than forced:
  // there is nothing left to do once the child is gone, so Node can wind down
  // on its own instead of being cut off mid-teardown.
  child.on('close', (code) => {
    process.exitCode = code ?? 1;
  });
}
