import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetAppConfigForTests, applyAppConfig } from '../src/lib/appConfig';
import { AppConfigGate } from '../src/ui/AppConfigGate';

/**
 * WHAT A CHILD SEES OF QRIE CONTROL IN THE TUTOR (plan 4). Written first.
 *
 * A banner above the app as plain text; an old build asked to update; the
 * tutor switched off shown as a pause. Both full-screen cards carry the
 * helplines, because they replace every screen, Help included (R25).
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

function mount(): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <AppConfigGate>
        <p data-testid="app">The app</p>
      </AppConfigGate>,
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
