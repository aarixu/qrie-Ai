// @vitest-environment node
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

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

  it('lets the https app call an http server only when built for a demo server on http', () => {
    const config = read(`${app}/capacitor.config.ts`);
    expect(config).toMatch(/allowMixedContent: demoOverHttp/);
    expect(config).toMatch(/cleartext: demoOverHttp/);
    expect(config).toMatch(/const demoOverHttp = \(process\.env\.VITE_QRIE_DEMO_URL \?\? ''\)\.startsWith\('http:\/\/'\)/);
  });
});
