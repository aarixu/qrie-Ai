/**
 * ENVIRONMENT, READ ONCE AND CHECKED LOUDLY.
 *
 * Both entry points start by reading this. A process that boots with half its
 * configuration and fails on the first raised hand is worse than one that
 * refuses to start: the first looks healthy for hours.
 *
 * The readers are pure — they take an environment object rather than reaching
 * for `process.env` — so the failure messages are testable.
 */

export type Env = Record<string, string | undefined>;

export interface TokenServerConfig {
  /** Passed to the browser so it knows where to connect. Never the secret. */
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  /** Interface to bind. Loopback by default — see {@link DEFAULT_HOST}. */
  host: string;
  port: number;
  /** The single browser origin allowed to call this server. Never "*". */
  allowedOrigin: string;
}

/**
 * Deliberately not 7880/7881/7882 — those are livekit-server's own ports, and
 * a port clash on a laptop running all three processes reads as a mystery
 * connection failure.
 */
export const DEFAULT_PORT = 7890;

/** Vite's dev server. Production sets TOKEN_SERVER_ORIGIN to the real origin. */
export const DEFAULT_ORIGIN = 'http://localhost:5173';

/**
 * Loopback only unless someone says otherwise. This process signs LiveKit
 * credentials; on a laptop sharing a café network, binding every interface
 * would put a credential minter on that network.
 */
export const DEFAULT_HOST = '127.0.0.1';

/** A real TCP port, or a startup error naming the variable that is wrong. */
export function readPort(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`TOKEN_SERVER_PORT must be a port number between 1 and 65535, got "${value}"`);
  }
  return port;
}

/**
 * A wildcard origin is refused rather than warned about. This server mints
 * credentials for a room; `*` would let any page on the internet ask for one
 * in a logged-in student's name.
 */
export function readOrigin(value: string | undefined): string {
  const origin = value?.trim();
  if (origin === undefined || origin.length === 0) return DEFAULT_ORIGIN;
  if (origin === '*') {
    throw new Error(
      'TOKEN_SERVER_ORIGIN must name one origin, e.g. http://localhost:5173. "*" would let any site mint a join token.',
    );
  }
  return origin;
}

const required = (env: Env, name: string): string => {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is not set. Copy apps/agent/.env.example to apps/agent/.env and fill it in.`);
  }
  return value;
};

export function readTokenServerConfig(env: Env): TokenServerConfig {
  return {
    livekitUrl: required(env, 'LIVEKIT_URL'),
    apiKey: required(env, 'LIVEKIT_API_KEY'),
    apiSecret: required(env, 'LIVEKIT_API_SECRET'),
    host: env.TOKEN_SERVER_HOST?.trim() || DEFAULT_HOST,
    port: readPort(env.TOKEN_SERVER_PORT),
    allowedOrigin: readOrigin(env.TOKEN_SERVER_ORIGIN),
  };
}

/**
 * The Gemini key, read here and passed explicitly to the realtime model.
 *
 * The plugin would find GOOGLE_API_KEY on its own and the Google SDK
 * underneath it would fall back to GEMINI_API_KEY — but a missing key does not
 * throw there. It logs a warning and then the websocket dies, which surfaces
 * to the student as a tutor who joins and says nothing.
 */
export function readGoogleApiKey(env: Env): string {
  const key = env.GOOGLE_API_KEY?.trim() || env.GEMINI_API_KEY?.trim();
  if (key === undefined || key.length === 0) {
    throw new Error(
      'GOOGLE_API_KEY is not set (GEMINI_API_KEY is accepted too). The live tutor cannot speak without it.',
    );
  }
  return key;
}

/**
 * Load apps/agent/.env if a developer has one. The LiveKit framework does not
 * read .env files, and Node can, so this is the whole of our dotenv story. A
 * missing file is the normal case in production, where the platform supplies
 * real environment variables.
 */
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile(new URL('../.env', import.meta.url));
  } catch {
    // No .env here. Nothing to say: the readers above report what is missing,
    // by name, at the moment it is actually needed.
  }
}
