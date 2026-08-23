import { describe, expect, it } from 'vitest';
import { DEV_PORTS, hasKeys, readPorts, websocketUrl } from '../src/config.ts';
import { banner, planLaunch } from '../src/server.ts';
// The committed config itself, as text. Imported rather than read from a path so
// this assertion holds wherever the suite is run from.
import shippedConfig from '../livekit.yaml?raw';

const CONFIG_WITHOUT_KEYS = `
port: 7880
bind_addresses:
  - 127.0.0.1
rtc:
  udp_port: 7882
  tcp_port: 7881
# keys:
#   APIfake: secret-that-is-only-a-comment
`;

const CONFIG_WITH_KEYS = `${CONFIG_WITHOUT_KEYS}
keys:
  APIabc123: this-is-not-a-real-secret-it-was-rotated-ok
`;

describe('hasKeys', () => {
  it('ignores commented-out key blocks', () => {
    expect(hasKeys(CONFIG_WITHOUT_KEYS)).toBe(false);
  });

  it('sees a real keys block', () => {
    expect(hasKeys(CONFIG_WITH_KEYS)).toBe(true);
  });

  it('counts key_file, because those keys are just kept elsewhere', () => {
    expect(hasKeys('key_file: ./livekit-keys.yaml\n')).toBe(true);
  });
});

describe('readPorts', () => {
  it('reads the three ports the config pins', () => {
    expect(readPorts(CONFIG_WITHOUT_KEYS)).toEqual({ signal: 7880, iceTcp: 7881, iceUdp: 7882 });
  });

  it('does not mistake port_range_start or udp_port for the signal port', () => {
    const text = 'rtc:\n  port_range_start: 50000\n  udp_port: 7882\n';
    expect(readPorts(text).signal).toBe(7880);
    expect(readPorts(text).iceUdp).toBe(7882);
  });

  it('reports the 50000-60000 range as such when no udp_port is pinned', () => {
    // null is the honest answer here: the banner says the range out loud rather
    // than printing a single port the server never opened.
    expect(readPorts('port: 7880\n').iceUdp).toBeNull();
  });

  it('ignores commented ports', () => {
    expect(readPorts('# udp_port: 9999\nudp_port: 7882\n').iceUdp).toBe(7882);
  });
});

describe('websocketUrl', () => {
  it('is 127.0.0.1, never localhost', () => {
    // Windows resolves localhost to ::1 first; being explicit removes the trap.
    expect(websocketUrl(7880)).toBe('ws://127.0.0.1:7880');
  });
});

describe('planLaunch', () => {
  it('runs the zero-config path with no file at all', () => {
    const plan = planLaunch({ config: null, keysInEnv: false });
    expect(plan.args).toEqual(['--dev']);
    expect(plan.configPath).toBeNull();
    expect(plan.ports).toEqual(DEV_PORTS);
    expect(plan.devKeys).toBe(true);
  });

  it('adds --dev to a keyless config, which is what makes the first run work', () => {
    const plan = planLaunch({
      config: { path: '/x/livekit.yaml', text: CONFIG_WITHOUT_KEYS },
      keysInEnv: false,
    });
    expect(plan.args).toEqual(['--config', '/x/livekit.yaml', '--dev']);
    expect(plan.devKeys).toBe(true);
  });

  it('leaves --dev off once the config carries real keys', () => {
    const plan = planLaunch({
      config: { path: '/x/livekit.yaml', text: CONFIG_WITH_KEYS },
      keysInEnv: false,
    });
    expect(plan.args).toEqual(['--config', '/x/livekit.yaml']);
    expect(plan.devKeys).toBe(false);
  });

  it('treats LIVEKIT_KEYS in the environment as real keys', () => {
    const plan = planLaunch({
      config: { path: '/x/livekit.yaml', text: CONFIG_WITHOUT_KEYS },
      keysInEnv: true,
    });
    expect(plan.args).toEqual(['--config', '/x/livekit.yaml']);
    expect(plan.devKeys).toBe(false);
  });
});

describe('banner', () => {
  const plan = planLaunch({ config: { path: '/x/livekit.yaml', text: CONFIG_WITHOUT_KEYS }, keysInEnv: false });

  it('prints the ports and the URL the app needs', () => {
    const text = banner({ plan, binary: '/x/bin/livekit-server', tag: 'v1.13.5', platform: 'linux' });
    expect(text).toContain('TCP 7880');
    expect(text).toContain('TCP 7881');
    expect(text).toContain('UDP 7882');
    expect(text).toContain('LIVEKIT_URL=ws://127.0.0.1:7880');
    expect(text).toContain('LIVEKIT_API_KEY=devkey');
  });

  it('warns about the firewall dialog only where that dialog exists', () => {
    const onWindows = banner({ plan, binary: 'C:\\bin\\livekit-server.exe', tag: 'v1.13.5', platform: 'win32' });
    expect(onWindows).toContain('Windows Defender');
    expect(onWindows).toContain('not a hang');
    expect(banner({ plan, binary: '/x/livekit-server', tag: 'v1.13.5', platform: 'linux' })).not.toContain(
      'Windows Defender',
    );
  });

  it('does not offer development credentials when real keys are in play', () => {
    const real = planLaunch({ config: { path: '/x/livekit.yaml', text: CONFIG_WITH_KEYS }, keysInEnv: false });
    const text = banner({ plan: real, binary: '/x/livekit-server', tag: 'v1.13.5', platform: 'linux' });
    expect(text).not.toContain('LIVEKIT_API_SECRET=secret');
  });
});

describe('the config this tool ships', () => {
  const text = shippedConfig;

  it('carries no keys — it is committed, so it must not be able to', () => {
    expect(hasKeys(text)).toBe(false);
  });

  it('pins media to one UDP port instead of inheriting the 10,001-port range', () => {
    expect(readPorts(text)).toEqual({ signal: 7880, iceTcp: 7881, iceUdp: 7882 });
  });

  it('keeps external IP discovery off, so startup makes no STUN call', () => {
    expect(text).toMatch(/^\s*use_external_ip:\s*false\s*$/m);
  });
});
