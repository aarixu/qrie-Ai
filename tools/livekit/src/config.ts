/**
 * READING JUST ENOUGH OF THE CONFIG FILE TO TELL THE TRUTH ABOUT IT.
 *
 * Two questions, both answered by text: does this file declare keys, and which
 * ports will the server actually open. There is no YAML parser here on purpose
 * — pulling a dependency into a tool whose whole job is "no dependencies, one
 * command" would be a poor trade, and these are line-shaped questions.
 *
 * Why bother at all: the banner printed before the server starts must match
 * what the server does. A banner that says "UDP 7882" over a config that never
 * set `rtc.udp_port` is worse than no banner, because the ten thousand ports it
 * really opened are exactly what the firewall dialog is about.
 */

export interface Ports {
  /** HTTP + the signalling WebSocket. The browser and the agent worker share it. */
  signal: number;
  /** ICE/TCP fallback for networks that block UDP. */
  iceTcp: number;
  /** The single UDP mux port, or null for LiveKit's 50000-60000 default range. */
  iceUdp: number | null;
}

/**
 * What `livekit-server --dev` opens with no config file at all — observed with
 * `livekit-server.exe ports --dev`, not assumed. Dev mode is the only mode that
 * collapses media onto one UDP port by itself.
 */
export const DEV_PORTS: Ports = { signal: 7880, iceTcp: 7881, iceUdp: 7882 };

/** LiveKit's own defaults when a config file leaves a port unset. */
const CONFIG_DEFAULT_SIGNAL = 7880;
const CONFIG_DEFAULT_ICE_TCP = 7881;

const uncommentedLines = (yamlText: string): string[] =>
  yamlText.split('\n').filter((line) => !/^\s*#/.test(line) && line.trim().length > 0);

/**
 * `--dev` injects devkey/secret only when the config declares no keys, so this
 * decides whether the first run can work without a secret in a committed file.
 * `key_file` counts: the keys are real, they just live elsewhere.
 */
export function hasKeys(yamlText: string): boolean {
  return uncommentedLines(yamlText).some((line) => /^(keys|key_file)\s*:/.test(line));
}

const intAfter = (lines: string[], key: string): number | null => {
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon < 0 || line.slice(0, colon).trim() !== key) continue;
    // Indentation is deliberately ignored: `port` and `rtc.udp_port` are unique
    // enough in a LiveKit config that tracking nesting would buy nothing.
    const value = line.slice(colon + 1).trim();
    const port = Number(value);
    if (value.length > 0 && Number.isInteger(port)) return port;
  }
  return null;
};

export function readPorts(yamlText: string): Ports {
  const lines = uncommentedLines(yamlText);
  return {
    signal: intAfter(lines, 'port') ?? CONFIG_DEFAULT_SIGNAL,
    iceTcp: intAfter(lines, 'tcp_port') ?? CONFIG_DEFAULT_ICE_TCP,
    // Absent means the 50000-60000 range, which the banner then says out loud.
    iceUdp: intAfter(lines, 'udp_port'),
  };
}

/** What the app and the agent worker put in LIVEKIT_URL. */
export function websocketUrl(signalPort: number): string {
  // 127.0.0.1, never localhost: Windows resolves localhost to ::1 first, and a
  // server bound IPv4-only then fails with an opaque browser error while curl
  // against 127.0.0.1 succeeds. Being explicit costs nothing and removes a trap.
  return `ws://127.0.0.1:${signalPort}`;
}
