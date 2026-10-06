import type { AdminClient, RelayStatus, Today } from '@ai-tutor/admin-client';

export interface TodayLoad {
  today: Today | null;
  relay: RelayStatus | null;
  /** Why something failed, '' when nothing did. */
  error: string;
}

/**
 * The home page's two reads, independent of each other. relay_status is the one
 * the stop button needs and is a single-row read; today() joins several tables.
 * A failure of the heavy read must never take the stop button with it.
 */
export async function loadToday(c: Pick<AdminClient, 'today' | 'relayStatus'>): Promise<TodayLoad> {
  const [t, r] = await Promise.allSettled([c.today(), c.relayStatus()]);
  const errors = [t, r]
    .filter((x): x is PromiseRejectedResult => x.status === 'rejected')
    .map((x) => (x.reason instanceof Error ? x.reason.message : String(x.reason)));
  return {
    today: t.status === 'fulfilled' ? t.value : null,
    relay: r.status === 'fulfilled' ? r.value : null,
    error: errors.join(' · '),
  };
}
