// @vitest-environment node
import fs from 'node:fs';
import type { CapacitorConfig } from '@capacitor/cli';
import { describe, expect, it, vi } from 'vitest';

/**
 * BOTH ANDROID APPS' SAFETY SETTINGS (the 2026-10-08 security review, OWASP
 * MASVS-STORAGE and MASVS-NETWORK). Written first.
 *
 * Nothing the apps keep on the phone — the sign-in, a child's answers and
 * photos waiting in the outbox — leaves it in a backup or a device transfer.
 * Plain http is allowed only in the debug build, for the demo school on a
 * laptop; a release build speaks https alone.
 */

const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
const configs: Record<string, () => Promise<{ default: CapacitorConfig }>> = {
  lms: () => import('../../lms/capacitor.config.ts'),
  student: () => import('../capacitor.config.ts'),
};

describe.each(['lms', 'student'])('the %s app on Android', (app) => {
  const main = read(`${app}/android/app/src/main/AndroidManifest.xml`);

  it('keeps its data out of backups and device transfers', () => {
    expect(main).toContain('android:allowBackup="false"');
    expect(main).toContain('android:fullBackupContent="false"');
    expect(main).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    const rules = read(`${app}/android/app/src/main/res/xml/data_extraction_rules.xml`);
    for (const part of ['cloud-backup', 'device-transfer']) {
      const section = new RegExp(`<${part}[^>]*>([\\s\\S]*?)</${part}>`).exec(rules)?.[1] ?? '';
      for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
        expect(section, `${part} excludes ${domain}`).toContain(`<exclude domain="${domain}"`);
      }
    }
  });

  it('allows plain http in the debug build only', () => {
    expect(main).not.toContain('usesCleartextTraffic');
    expect(read(`${app}/android/app/src/debug/AndroidManifest.xml`)).toContain('android:usesCleartextTraffic="true"');
  });

  it('lets the https app call an http server only when built for a demo server on http', async () => {
    // What `cap sync` reads from its environment, as each kind of build sets it.
    const http = async (env: Record<string, string>) => {
      for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_QRIE_DEMO_URL']) vi.stubEnv(name, env[name] ?? '');
      vi.resetModules();
      const { default: config } = await configs[app]();
      vi.unstubAllEnvs();
      return { cleartext: config.server?.cleartext, allowMixedContent: config.android?.allowMixedContent };
    };
    const lan = 'http://192.168.1.121:54400';
    expect(await http({ VITE_QRIE_DEMO_URL: lan })).toEqual({ cleartext: true, allowMixedContent: true });
    expect(await http({})).toEqual({ cleartext: false, allowMixedContent: false });
    expect(await http({ VITE_QRIE_DEMO_URL: 'https://demo.example' })).toEqual({ cleartext: false, allowMixedContent: false });
    // A build for the hosted project never uses the demo address, even one left in the environment.
    const hosted = { VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon-key' };
    expect(await http({ ...hosted, VITE_QRIE_DEMO_URL: lan })).toEqual({ cleartext: false, allowMixedContent: false });
    expect(await http(hosted)).toEqual({ cleartext: false, allowMixedContent: false });
  });
});
