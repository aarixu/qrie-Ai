import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetAppConfigForTests, applyAppConfig } from '../src/lib/appConfig';
import { AppConfigGate } from '../src/ui/AppConfigGate';

/**
 * WHAT A CHILD SEES OF QRIE CONTROL IN THE TUTOR. Written first.
 *
 * A banner above the app as plain text; an old build asked to update; the
 * tutor switched off shown as a pause. Both full-screen cards carry the
 * helplines (R25). The update card replaces every screen. The pause card
 * replaces the learning screens only: a child can still report something from
 * it, and reach their account (Settings, Profile, Sign in) and Help.
 */

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  __resetAppConfigForTests();
});
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
  __resetAppConfigForTests();
});

/** The gate in front of stand-in screens, starting at `at`. */
function mount(at = '/'): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <AppConfigGate>
          <Routes>
            {['/settings', '/profile', '/signin', '/help'].map((path) => (
              <Route key={path} path={path} element={<p data-testid="screen">{path}</p>} />
            ))}
            <Route path="*" element={<p data-testid="app">The app</p>} />
          </Routes>
        </AppConfigGate>
      </MemoryRouter>,
    ),
  );
  return host;
}

const apply = (raw: unknown) => act(() => applyAppConfig(raw));
const app = (host: HTMLElement) => host.querySelector('[data-testid="app"]');
const helplines = (host: HTMLElement) => [
  host.querySelector('a[href="tel:14416"]'),
  host.querySelector('a[href="tel:1098"]'),
];

describe('the gate', () => {
  it('with the defaults it shows the app and nothing else', () => {
    const host = mount();
    expect(app(host)).not.toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('a banner sits above the app, as plain text, in its tone', () => {
    const host = mount();
    apply({ 'banner.message': '<b>Back</b> at 7', 'banner.tone': 'warning' });
    const banner = host.querySelector('[role="status"]')!;
    expect(banner.textContent).toBe('<b>Back</b> at 7');
    expect(banner.querySelector('b')).toBeNull();
    expect(banner.getAttribute('data-tone')).toBe('warning');
    expect(app(host)).not.toBeNull();
  });

  it('an older build is asked to update and shown nothing else but the helplines', () => {
    const host = mount();
    apply({ 'app.min_version.classroom': '9.0.0' });
    expect(host.textContent).toContain('Time to update Qrie');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Reload')).toBe(true);
    expect(app(host)).toBeNull();
    for (const link of helplines(host)) expect(link).not.toBeNull();
    apply({ 'app.min_version.classroom': '9.0' });
    expect(app(host)).not.toBeNull();
  });

  it('the tutor switched off shows the pause notice, with the helplines, instead of the app', () => {
    const host = mount();
    apply({ 'tutor.enabled': false });
    expect(host.textContent).toContain('The tutor is switched off for now');
    expect(app(host)).toBeNull();
    for (const link of helplines(host)) expect(link).not.toBeNull();
    apply({ 'tutor.enabled': false, 'banner.message': 'Back on Monday' });
    const banner = host.querySelector('[role="status"]')!;
    expect(banner.textContent).toBe('Back on Monday');
    // The banner comes before the pause card in the page.
    const card = [...host.querySelectorAll('h1, h2')].find((h) => h.textContent === 'The tutor is switched off for now')!;
    expect(banner.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('while the tutor is switched off', () => {
  const screen = (host: HTMLElement) => host.querySelector('[data-testid="screen"]')?.textContent ?? null;
  const control = (host: HTMLElement, text: string) =>
    [...host.querySelectorAll<HTMLElement>('a, button')].find((el) => el.textContent?.trim() === text) ?? null;

  it("the child's account and Help stay open: Settings, Profile, Sign in and Help", () => {
    for (const path of ['/settings', '/profile', '/signin', '/help']) {
      const host = mount(path);
      apply({ 'tutor.enabled': false });
      expect(screen(host), path).toBe(path);
      expect(host.textContent).not.toContain('The tutor is switched off for now');
    }
  });

  it('every other screen shows the pause card, which leads to Settings and Help', () => {
    const host = mount('/syllabus');
    apply({ 'tutor.enabled': false });
    expect(app(host)).toBeNull();
    expect(host.textContent).toContain('The tutor is switched off for now');
    act(() => control(host, 'Settings: sign out or delete your account')!.click());
    expect(screen(host)).toBe('/settings');

    const again = mount('/');
    act(() => control(again, 'Help')!.click());
    expect(screen(again)).toBe('/help');
  });

  it('the pause card opens the report sheet', async () => {
    const host = mount('/');
    apply({ 'tutor.enabled': false });
    // The sheet is a lazy chunk; load it first so the wait below is React's, not the transform's.
    await import('../src/ui/ReportSheet');
    await act(async () => control(host, 'Report something')!.click());
    await vi.waitFor(
      async () => {
        await act(async () => {});
        expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      },
      { timeout: 5_000 },
    );
    const sheet = host.querySelector('[role="dialog"]')!;
    expect(sheet.getAttribute('aria-label')).toBe('Report something');
    expect([...sheet.querySelectorAll('button')].some((b) => b.textContent === 'Send report')).toBe(true);
    // The helplines stay on the card behind it.
    for (const link of helplines(host)) expect(link).not.toBeNull();
  });
});
