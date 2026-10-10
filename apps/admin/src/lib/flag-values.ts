import type { FlagRow } from '@ai-tutor/admin-client';

/** A minimum build: three whole numbers of up to four digits (admin.flag_valid, 0062). */
const VERSION = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/;

/**
 * What is wrong with a switch's new value, or null when admin.flag_valid
 * (0062) would take it: the same rules, so the editor refuses a value before
 * the database does. The database still checks every write.
 */
export function flagValueProblem(kind: FlagRow['kind'], value: unknown): string | null {
  switch (kind) {
    case 'bool':
      return typeof value === 'boolean' ? null : 'On or off.';
    case 'tone':
      return value === 'info' || value === 'warning' ? null : 'Choose info or warning.';
    case 'version':
      return typeof value === 'string' && VERSION.test(value) ? null : 'Write three numbers, such as 0.1.0.';
    case 'count':
      return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100000
        ? null
        : 'A whole number from 1 to 100000.';
    case 'text':
      // Postgres counts characters, not UTF-16 units.
      return typeof value === 'string' && [...value].length <= 280 ? null : 'At most 280 characters.';
    default:
      return 'This kind of switch cannot be set here.';
  }
}
