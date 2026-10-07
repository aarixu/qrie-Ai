import { toAdminError } from './errors.ts';

/**
 * Reading what the transport hands back, shared by the plan 2 client modules
 * (schools, users, staff, system). Not exported from the package.
 */

/** Runs one call; any failure becomes a typed AdminError, as api.ts does. */
export async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    throw toAdminError(e);
  }
}

export const str = (v: unknown): string => String(v);

/** A nullable text or timestamp column. */
export const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * A `date` column as YYYY-MM-DD: PostgREST sends `2026-10-05`, the PGlite
 * transport `2026-10-05T00:00:00.000Z`.
 */
export const day = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).slice(0, 10));

/** An integer or bigint column; PostgREST may send a bigint as text. */
export const num = (v: unknown): number => Number(v);
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
