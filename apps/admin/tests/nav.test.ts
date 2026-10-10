import type { Me } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import { sidebarData } from '../src/components/layout/data/sidebar-data.ts';
import { homeFor, navFor, showsHeaderStop } from '../src/lib/nav.ts';

/**
 * WHAT EACH STAFF ROLE SEES IN THE SIDEBAR, and where it lands. Written first.
 * Each item's roles mirror its page's database read (the database refuses the
 * rest anyway); the owner sees every item.
 */

const titles = (role: Me['role']) => navFor(role, sidebarData).flatMap((g) => g.items.map((i) => i.title));
const every = sidebarData.navGroups.flatMap((g) => g.items.map((i) => i.title));

describe('the sidebar follows the signed-in role', () => {
  it('the owner sees every item', () => {
    expect(titles('owner')).toEqual(every);
  });

  it('ops sees everything but Staff and audit', () => {
    expect(titles('ops')).toEqual(every.filter((t) => t !== 'Staff and audit'));
  });

  it('safety sees Today, Schools, Switches, Apps, System and Your account', () => {
    expect(titles('safety')).toEqual(['Today', 'Schools', 'Switches', 'Apps', 'System', 'Your account']);
  });

  it('finance sees Your account and the Billing pages, and nothing about children or switches', () => {
    expect(titles('finance')).toEqual([
      'Your account',
      'Billing',
      'Invoices',
      'Subscriptions',
      'Payments',
      'Schools',
      'Webhook log',
      'Plans',
      'Settings',
    ]);
    expect(navFor('finance', sidebarData).map((g) => g.title)).toEqual(['Platform', 'Billing']);
  });

  it('an item without roles is for every role', () => {
    const data = { navGroups: [{ title: 'G', items: [{ title: 'Open', url: '/x' }] }] };
    expect(navFor('safety', data).flatMap((g) => g.items.map((i) => i.title))).toEqual(['Open']);
  });

  it('finance lands on Billing; everyone else on Today', () => {
    expect(homeFor('finance')).toBe('/billing');
    for (const role of ['owner', 'ops', 'safety'] as const) expect(homeFor(role), role).toBe('/');
  });

  it('only finance needs the stop in the header (Today and System carry it for the others)', () => {
    expect(showsHeaderStop('finance')).toBe(true);
    for (const role of ['owner', 'ops', 'safety'] as const) expect(showsHeaderStop(role), role).toBe(false);
  });
});
