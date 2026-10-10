/**
 * WHAT A WRITE WILL DO, SAID BEFORE IT IS CONFIRMED: one sentence or two per
 * action, shown at the top of every write dialog. Pure, so the wording that
 * matters (who is affected, what stops, what can be undone) is tested.
 */

export function blastLicence(code: string, plan: string, seats: number, until: string, seatsUsed: number): string {
  const line = `${code}'s licence becomes ${plan}, ${seats} seats, until ${until}. The school admin sees it at once.`;
  return seats < seatsUsed ? `${line} ${seatsUsed} seats are in use: the school cannot add students until some leave.` : line;
}

/**
 * Offboarding is a mark plus the school's tutor switch off (0053). With 0063
 * and 0064 the database refuses the school's children new tutor classes (the
 * switch, in claim_relay) and refuses new people from staff and from the
 * school admin alike (admin.import_refusal). Bringing the school back clears
 * the mark only; the tutor switch is the owner's to turn on.
 */
export function blastOffboard(code: string, offboard: boolean): string {
  return offboard
    ? `${code} is marked offboarded and its tutor switch is set off: the database refuses its children new tutor classes,` +
        ' and neither Qrie staff nor its school admin can add people to it. Nothing is deleted: homework, marks and sign-ins stay.'
    : `${code} is no longer marked offboarded, so people can be added again unless its licence is suspended.` +
        ' Its tutor switch stays off until the owner turns it on.';
}

/** `enabled` is the tutor.enabled value being set for the school. */
export function blastPause(code: string, enabled: boolean): string {
  return enabled
    ? `${code}'s tutor switch is set on: ${code}'s children can take tutor classes again, unless its licence is suspended.`
    : `${code}'s tutor switch is set off: the database refuses new tutor classes for ${code}'s children and the tutor app shows them a pause notice.` +
        ' Homework, marks and the student and teacher apps carry on.';
}

/** Any other switch set for one school. */
export function blastSchoolSwitch(code: string): string {
  return `Saved for ${code}: this value replaces the platform's for ${code} in every app and check that reads the switch.`;
}

export function blastDisable(code: string, loginId: string, kind: string): string {
  const out = kind === 'student' || kind === 'teacher' ? 'signed out and taken out of their classes' : 'signed out';
  return `${loginId} leaves ${code} now: ${out}. The school admin can bring them back from Leavers in the teacher app.`;
}

export function blastResetPin(code: string, loginId: string): string {
  return `${loginId}'s old PIN stops working at once and they are signed out everywhere. Ask ${code}'s school admin first: they can do this in the teacher app.`;
}

export function blastExport(code: string): string {
  return `Three files with the names and IDs of everyone at ${code} are saved to this computer. Keep them as you would the school's register.`;
}

export function blastImport(code: string, people: number): string {
  return `${people} new sign-in${people === 1 ? ' is' : 's are'} made at ${code}. Their PINs are shown once, on the next screen.`;
}

export function blastCreate(code: string, yearLabel: string): string {
  return `A new, empty school ${code} is created with the year ${yearLabel}. Nobody can sign in to it until people are added.`;
}

export function blastQuiet(code: string, until: string | null): string {
  return until
    ? `At ${code}, the teaching, learning, attendance and last-active signals read grey until ${until}.`
    : `${code}'s holiday is cleared: every signal counts again.`;
}

export function blastContact(code: string): string {
  return `Saved in Qrie's notes on ${code}. The school does not see them.`;
}

export function blastNote(code: string): string {
  return blastContact(code);
}

export function blastBlock(blocked: boolean): string {
  return blocked
    ? 'This account cannot sign in or use the tutor until it is unblocked. Its data stays.'
    : 'This account can sign in again.';
}

export function blastInvite(name: string, role: string): string {
  return `${name} gets a sign-in for Qrie control as ${role}. It stays switched off until you turn it on after they set up an authenticator.`;
}

/** An account made for staff that was never put on the list (a half-finished invitation). */
export function blastAddExisting(name: string, role: string): string {
  return `${name} joins the staff list as ${role}, switched off. Turn them on after they have set up an authenticator and you have spoken to them.`;
}

export function blastStaff(name: string, role: string, active: boolean, wasActive: boolean): string {
  if (active && !wasActive) return `${name} can use Qrie control as ${role} from their next click. Only do this after you have spoken to them.`;
  if (!active && wasActive) return `${name} loses access on their next click.`;
  if (active) return `${name}'s role becomes ${role} from their next click.`;
  return `${name} stays switched off, as ${role}.`;
}

/**
 * A raise lasts the UTC day: admin-revert-caps (0048) puts it back at 00:05
 * UTC. `revertsTo` is the ceiling it goes back to (an earlier raise's starting
 * point when one is still in force); a cut to or below today's spend is
 * refused by the database unless the tutor is stopped.
 */
export function blastCeiling(units: number, current: number, spentToday: number, revertsTo: number = current): string {
  if (units > current) {
    return `Up to ${units} units today. It goes back to ${revertsTo} units just after midnight UTC (05:35 in India) by itself.`;
  }
  const line = `The ceiling becomes ${units} units.`;
  return units <= spentToday
    ? `${line} Today's spend is already ${spentToday} units, so the tutor takes no new work today: stop the tutor first, or the database refuses this.`
    : line;
}

export function blastRestoreDrill(on: string): string {
  return `Records that a backup was restored and checked on ${on}.`;
}
