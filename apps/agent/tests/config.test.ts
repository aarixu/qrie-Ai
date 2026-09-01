import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOST,
  DEFAULT_ORIGIN,
  DEFAULT_PORT,
  readGoogleApiKey,
  readOrigin,
  readPort,
  readTokenServerConfig,
} from '../src/config.ts';

const livekit = {
  LIVEKIT_URL: 'ws://127.0.0.1:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'secret',
  // Required now: this server mints join tokens and dispatches a paid agent,
  // and it cannot check who is asking without a project to ask.
  SUPABASE_URL: 'https://p.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
};

describe('readTokenServerConfig', () => {
  it('trims a trailing slash off the project URL, which would 404 as a bad sign-in', () => {
    const config = readTokenServerConfig({ ...livekit, SUPABASE_URL: 'https://p.supabase.co/' });
    expect(config.supabaseUrl).toBe('https://p.supabase.co');
  });

  it('fills in the local defaults around the three LiveKit values', () => {
    expect(readTokenServerConfig(livekit)).toEqual({
      livekitUrl: 'ws://127.0.0.1:7880',
      apiKey: 'devkey',
      apiSecret: 'secret',
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
      allowedOrigin: DEFAULT_ORIGIN,
      supabaseUrl: 'https://p.supabase.co',
      supabaseAnonKey: 'anon',
    });
  });

  it('names the variable that is missing', () => {
    for (const name of [
      'LIVEKIT_URL',
      'LIVEKIT_API_KEY',
      'LIVEKIT_API_SECRET',
      // A token server that cannot verify anyone mints for everyone, so
      // these are required rather than defaulted to "off".
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
    ]) {
      const env: Record<string, string | undefined> = { ...livekit };
      delete env[name];
      expect(() => readTokenServerConfig(env)).toThrow(name);
    }
    expect(() => readTokenServerConfig({ ...livekit, LIVEKIT_API_KEY: '   ' })).toThrow(
      'LIVEKIT_API_KEY',
    );
  });

  it('takes host, port and origin from the environment', () => {
    const config = readTokenServerConfig({
      ...livekit,
      TOKEN_SERVER_HOST: '0.0.0.0',
      TOKEN_SERVER_PORT: '9000',
      TOKEN_SERVER_ORIGIN: 'https://class.example.com',
    });
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(9000);
    expect(config.allowedOrigin).toBe('https://class.example.com');
  });
});

describe('readPort', () => {
  it('defaults away from livekit-server’s own ports', () => {
    expect(readPort(undefined)).toBe(DEFAULT_PORT);
    expect(readPort('  ')).toBe(DEFAULT_PORT);
    expect([7880, 7881, 7882]).not.toContain(DEFAULT_PORT);
  });

  it('refuses anything a browser could not reach', () => {
    for (const value of ['0', '-1', '65536', 'eight thousand', '80.5']) {
      expect(() => readPort(value)).toThrow('TOKEN_SERVER_PORT');
    }
  });
});

describe('readOrigin', () => {
  it('defaults to the vite dev server', () => {
    expect(readOrigin(undefined)).toBe(DEFAULT_ORIGIN);
    expect(readOrigin('')).toBe(DEFAULT_ORIGIN);
  });

  it('refuses a wildcard outright — it would let any site mint a token', () => {
    expect(() => readOrigin('*')).toThrow('TOKEN_SERVER_ORIGIN');
  });
});

describe('readGoogleApiKey', () => {
  it('accepts either name the Google SDKs use', () => {
    expect(readGoogleApiKey({ GOOGLE_API_KEY: 'k1' })).toBe('k1');
    expect(readGoogleApiKey({ GEMINI_API_KEY: 'k2' })).toBe('k2');
    expect(readGoogleApiKey({ GOOGLE_API_KEY: 'k1', GEMINI_API_KEY: 'k2' })).toBe('k1');
  });

  it('fails loudly rather than letting the tutor join and stay silent', () => {
    expect(() => readGoogleApiKey({})).toThrow('GOOGLE_API_KEY');
    expect(() => readGoogleApiKey({ GOOGLE_API_KEY: '  ' })).toThrow('GOOGLE_API_KEY');
  });
});
