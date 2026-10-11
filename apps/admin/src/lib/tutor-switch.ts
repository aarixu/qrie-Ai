/**
 * THE SCHOOL PAGE'S TUTOR BUTTON, decided in one place.
 *
 * A school's own tutor.enabled value wins over the platform's
 * (public.app_config: the school's, then the global, then the safe default).
 * Switching a school off writes a value of its own. Resuming a school paused
 * on its own while the platform is on clears that value (admin.flag_clear,
 * 0075), so the school follows the platform's switch again; only a school
 * resumed while the platform is off gets a value of its own, which then makes
 * it ignore the platform's switch (blastPause says so).
 *
 * `own` is the school's own value (undefined when it has none); `platform` is
 * the global value, or the safe default when none is set.
 */
export interface SchoolTutorAction {
  label: string;
  write: { kind: 'set'; value: boolean } | { kind: 'clear' };
  /** Whether the school's tutor is on afterwards (the button's direction). */
  turnsOn: boolean;
}

export function schoolTutorAction(own: unknown, platform: unknown): SchoolTutorAction {
  const on = own === undefined ? platform !== false : own !== false;
  if (on) return { label: 'Turn the tutor switch off', write: { kind: 'set', value: false }, turnsOn: false };
  if (own !== undefined && platform !== false) return { label: 'Turn the tutor switch back on', write: { kind: 'clear' }, turnsOn: true };
  return { label: 'Turn the tutor switch back on', write: { kind: 'set', value: true }, turnsOn: true };
}
