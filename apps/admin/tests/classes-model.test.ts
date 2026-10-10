import type { ClassCost, ClassRow } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import { blastPublish, blastRemove, classRights, costText } from '../src/features/classes/model.ts';

/** What the Classes pages show and offer, decided in one pure place. Written first. */

const cost = (over: Partial<ClassCost> = {}): ClassCost => ({ inr: 0, liveInr: 0, warmInr: 0, unpriced: false, calls: 0, sittings: 0, ...over });
const row: ClassRow = {
  id: 'cls-1',
  topicRef: 'science/8/light',
  title: 'Light and shadows',
  subtitle: null,
  klass: 8,
  subject: 'science',
  status: 'published',
  createdAt: '2026-10-01T10:00:00Z',
  publishedAt: null,
  version: 1,
  reports: { total: 0, open: 0, unsafe: 0 },
  cost: cost(),
  lastAction: null,
};

describe('class rights', () => {
  it('the owner may do all of it; ops read, retract and reject; safety reads; finance nothing', () => {
    expect(classRights('owner')).toEqual({ read: true, publish: true, retract: true, reject: true });
    expect(classRights('ops')).toEqual({ read: true, publish: false, retract: true, reject: true });
    expect(classRights('safety')).toEqual({ read: true, publish: false, retract: false, reject: false });
    expect(classRights('finance')).toEqual({ read: false, publish: false, retract: false, reject: false });
  });
});

describe('cost', () => {
  it('says when nothing is recorded, a floor when a call is unpriced, else the amount', () => {
    expect(costText(cost())).toEqual({ tone: 'grey', text: 'No sittings recorded' });
    expect(costText(cost({ sittings: 2 }))).toEqual({ tone: 'grey', text: 'No calls recorded' });
    expect(costText(cost({ inr: 12.5, calls: 3, sittings: 1, unpriced: true }))).toEqual({ tone: 'ok', text: 'At least ₹12.50' });
    expect(costText(cost({ inr: 1234, calls: 40, sittings: 9 }))).toEqual({ tone: 'ok', text: '₹1,234.00' });
  });
});

describe('blast lines', () => {
  it('publish, retract and reject say exactly what happens', () => {
    expect(blastPublish(row)).toBe(
      'Light and shadows becomes visible to every student who opens science/8/light. Who published it and why is kept.',
    );
    expect(blastRemove(row, 'retract')).toBe(
      'Light and shadows disappears from the catalogue now and its files are deleted from Storage. A student who opens this topic next' +
        ' prepares it again, and that new class is shared when it is kept. Its reports stay.',
    );
    expect(blastRemove(row, 'reject')).toBe('Light and shadows is never shown. Its files are deleted from Storage.');
  });
});
