import type { ClassCost, ClassRow, Me } from '@ai-tutor/admin-client';
import { formatPaise } from '../billing/money.ts';

/**
 * What the Classes pages show and offer, decided in one pure place.
 *
 * Rights (spec section 3, rulings R15 and R28): the owner publishes, retracts
 * and rejects; ops retracts and rejects; safety reads; finance sees nothing.
 * Retract and reject ask for a fresh authenticator code, because the class's
 * files are then deleted for good. The database refuses anyway.
 */

export interface ClassRights {
  read: boolean;
  publish: boolean;
  retract: boolean;
  reject: boolean;
}

export function classRights(role: Me['role']): ClassRights {
  const owner = role === 'owner';
  const remove = owner || role === 'ops';
  return { read: remove || role === 'safety', publish: owner, retract: remove, reject: remove };
}

/** "At least" when any call was unpriced (ruling R18). */
export function costText(c: ClassCost): { tone: 'grey' | 'ok'; text: string } {
  if (c.calls === 0) return { tone: 'grey', text: c.sittings === 0 ? 'No sittings recorded' : 'No calls recorded' };
  const amount = formatPaise(Math.round(c.inr * 100));
  return { tone: 'ok', text: c.unpriced ? `At least ${amount}` : amount };
}

export function blastPublish(c: ClassRow): string {
  return `${c.title} becomes visible to every student who opens ${c.topicRef}. Who published it and why is kept.`;
}

export function blastRemove(c: ClassRow, action: 'retract' | 'reject'): string {
  return action === 'retract'
    ? `${c.title} disappears from the catalogue now and its files are deleted from Storage. A student who opens this topic next` +
        ' prepares it again, and that new class is shared when it is kept. Its reports stay.'
    : `${c.title} is never shown. Its files are deleted from Storage.`;
}
