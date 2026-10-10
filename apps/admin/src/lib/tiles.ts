import type { Today } from '@ai-tutor/admin-client';

/**
 * WHAT THE HOME PAGE SAYS, DECIDED IN ONE PLACE. Pure, so the rules are tested:
 * a number that means "we cannot see" is grey, never green and never zero.
 */
export type Tone = 'ok' | 'warn' | 'bad' | 'grey';

export interface Tile {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

/** A licence is worth a line on the home page from this many days before it ends. */
export const LICENCE_WARN_DAYS = 30;

/** The alarm checker runs every 5 minutes; quiet for three runs is a dead checker. */
export const ALARM_STALE_MINUTES = 15;

const share = (used: number, of: number): number => (of > 0 ? used / of : 0);

export function tilesFor(t: Today): Tile[] {
  const spend = share(t.relay.unitsToday, t.relay.ceilingUnits);
  const alarm = t.alarm.lastCheckMinutesAgo;
  return [
    {
      key: 'tutor',
      label: 'Tutor',
      value: t.relay.halted ? 'Stopped' : 'Running',
      detail: t.relay.halted ? (t.relay.haltedReason ?? 'stopped') : `${t.relay.studentsNow} learning in the last 10 minutes`,
      tone: t.relay.halted ? 'bad' : 'ok',
    },
    {
      key: 'spend',
      label: "Today's spend",
      value: `${Math.round(spend * 100)}%`,
      detail: `${t.relay.unitsToday} of ${t.relay.ceilingUnits} meter units (units, not rupees)`,
      tone: spend >= 1 ? 'bad' : spend >= 0.8 ? 'warn' : 'ok',
    },
    {
      key: 'reports',
      label: 'Reports from children',
      value: `${t.reports.newCount} new`,
      detail:
        t.reports.unsafeNew > 0
          ? `${t.reports.unsafeNew} unsafe, the oldest ${t.reports.oldestNewMinutes} min`
          : t.reports.newCount > 0
            ? `the oldest ${t.reports.oldestNewMinutes} min`
            : 'none waiting',
      tone: t.reports.unsafeNew > 0 ? 'bad' : t.reports.newCount > 0 ? 'warn' : 'ok',
    },
    {
      key: 'distress',
      label: 'Distress flags',
      value: t.capture.distress === 'not-captured' ? 'Not captured' : 'Captured',
      detail:
        t.capture.distress === 'not-captured'
          ? 'No flag has reached the server and the day capture went live is not recorded on Safety, so this is unknown, not zero.'
          : 'Counted on the server.',
      tone: t.capture.distress === 'not-captured' ? 'grey' : 'ok',
    },
    {
      key: 'classes',
      label: 'Classes waiting for review',
      value: `${t.classes.pendingCount}`,
      detail: t.classes.pendingCount > 0 ? `the oldest ${t.classes.oldestPendingHours} h` : 'none waiting',
      tone: t.classes.pendingCount > 0 ? 'warn' : 'ok',
    },
    {
      key: 'contest',
      label: "Today's contest entries",
      value: `${t.contest.entriesToday} of ${t.contest.dailyCap}`,
      // Closed: no new entry comes in while it is, so the count needs no watching.
      detail: t.contest.entriesOpen ? 'new entries stop for the day at the limit' : 'entries are closed (contest.entries_open)',
      tone: !t.contest.entriesOpen
        ? 'ok'
        : share(t.contest.entriesToday, t.contest.dailyCap) >= 1
          ? 'bad'
          : share(t.contest.entriesToday, t.contest.dailyCap) >= 0.8
            ? 'warn'
            : 'ok',
    },
    {
      key: 'prices',
      label: 'Cost meter',
      value: t.prices.modelPriceRows === 0 ? 'Prices missing' : `${t.prices.modelPriceRows} prices`,
      detail: t.prices.modelPriceRows === 0 ? 'Rupee figures read zero until model prices are loaded.' : 'model prices loaded',
      tone: t.prices.modelPriceRows === 0 ? 'warn' : 'ok',
    },
    {
      key: 'alarm',
      label: 'Alarm checker',
      value: alarm === null ? 'Never ran' : alarm > ALARM_STALE_MINUTES ? `Silent ${alarm} min` : `Checked ${alarm} min ago`,
      detail: 'It watches from outside this project; if it goes quiet, nothing else will say so.',
      tone: alarm === null || alarm > ALARM_STALE_MINUTES ? 'bad' : 'ok',
    },
  ];
}

export interface SchoolNote {
  code: string;
  text: string;
  tone: Tone;
}

/** The schools on the home page: licence ending soon, ended, or the seats nearly all taken. */
export function schoolNotes(t: Today): SchoolNote[] {
  const notes: SchoolNote[] = [];
  for (const s of t.schools) {
    if (s.daysLeft !== null && s.daysLeft <= LICENCE_WARN_DAYS) {
      if (s.daysLeft < 0) notes.push({ code: s.code, tone: 'bad', text: `${s.name}: licence ended ${-s.daysLeft} day(s) ago` });
      else notes.push({ code: s.code, tone: s.daysLeft <= 7 ? 'bad' : 'warn', text: `${s.name}: licence ends in ${s.daysLeft} day(s)` });
    }
    if (s.seats && s.seatsUsed * 10 >= s.seats * 9) {
      notes.push({ code: s.code, tone: 'warn', text: `${s.name}: ${s.seatsUsed} of ${s.seats} seats used` });
    }
  }
  return notes;
}
