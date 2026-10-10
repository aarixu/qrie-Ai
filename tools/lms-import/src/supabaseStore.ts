import type { ImportStore, NewAccount } from './apply.ts';
import type { SchoolConfig } from './plan.ts';

/**
 * The import's store against the real project, with the service role, over
 * plain HTTP — the auth admin API for accounts and PostgREST for rows.
 *
 * `lms` tables are reached through the `lms` profile, which only works once
 * the schema is exposed to the Data API (0022's header says where).
 *
 * The service role key is the most powerful credential the project has. It
 * is read from the environment by the CLI, sent only in these headers, and
 * never included in an error message.
 */
export type RestCall = (
  path: string,
  init?: { method?: string; body?: unknown; profile?: 'lms'; prefer?: string },
) => Promise<unknown>;

/**
 * One HTTP call to the project with the service role. Shared by every LMS tool
 * that writes with that key, so there is exactly one place that decides what
 * an error message may contain: the server's words, never a header.
 */
export function supabaseRest(url: string, serviceKey: string, fetchImpl: typeof fetch = fetch): RestCall {
  const base = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };

  return async function call(path, init = {}) {
    const headers: Record<string, string> = { ...base };
    if (init.profile) headers[init.method && init.method !== 'GET' ? 'Content-Profile' : 'Accept-Profile'] = init.profile;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.prefer) headers.prefer = init.prefer;
    const res = await fetchImpl(`${url}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      // The body is the server's words; the request's headers are never shown.
      throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} failed: ${res.status} ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : null;
  };
}

/** One of the lms schema's functions, called with the service role through the Data API; its JSON answer. */
export function lmsRpc(call: RestCall): (fn: string, args: Record<string, unknown>) => Promise<unknown> {
  return (fn, args) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', profile: 'lms', body: args });
}

export function supabaseStore(url: string, serviceKey: string, fetchImpl: typeof fetch = fetch): ImportStore {
  const call = supabaseRest(url, serviceKey, fetchImpl);

  const firstId = (rows: unknown, field = 'id'): string | null => {
    const row = Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
    const v = row?.[field];
    return typeof v === 'string' ? v : null;
  };

  const q = encodeURIComponent;
  const insertOne = async (table: string, body: Record<string, unknown>, profile?: 'lms'): Promise<string> => {
    const rows = await call(`/rest/v1/${table}`, {
      method: 'POST',
      body,
      prefer: 'return=representation',
      ...(profile ? { profile } : {}),
    });
    const id = firstId(rows);
    if (!id) throw new Error(`insert into ${table} returned no id`);
    return id;
  };

  return {
    async ensureSchool(cfg: SchoolConfig) {
      const found = firstId(await call(`/rest/v1/school?code=eq.${q(cfg.code)}&select=org_id`, { profile: 'lms' }), 'org_id');
      if (found) return found;
      const org = await insertOne('organization', { kind: 'school', name: cfg.displayName });
      await call('/rest/v1/school', {
        method: 'POST',
        profile: 'lms',
        body: {
          org_id: org,
          code: cfg.code,
          display_name: cfg.displayName,
          short_name: cfg.shortName ?? null,
          board: cfg.board,
        },
      });
      return org;
    },

    async ensureYear(org, y) {
      return (
        firstId(await call(`/rest/v1/academic_year?org_id=eq.${org}&label=eq.${q(y.label)}&select=id`, { profile: 'lms' })) ??
        insertOne('academic_year', { org_id: org, label: y.label, starts_on: y.startsOn, ends_on: y.endsOn }, 'lms')
      );
    },

    async ensureSubject(org, name) {
      return (
        firstId(await call(`/rest/v1/subject?org_id=eq.${org}&name=eq.${q(name)}&select=id`, { profile: 'lms' })) ??
        insertOne('subject', { org_id: org, name }, 'lms')
      );
    },

    async ensureSection(org, year, grade, name) {
      return (
        firstId(
          await call(`/rest/v1/section?academic_year_id=eq.${year}&grade=eq.${grade}&name=eq.${q(name)}&select=id`, {
            profile: 'lms',
          }),
        ) ?? insertOne('section', { org_id: org, academic_year_id: year, grade, name }, 'lms')
      );
    },

    async findAccount(org, loginId) {
      return firstId(
        await call(`/rest/v1/account?org_id=eq.${org}&login_id=eq.${q(loginId)}&select=user_id`, { profile: 'lms' }),
        'user_id',
      );
    },

    async createAccount(a: NewAccount) {
      const user = (await call('/auth/v1/admin/users', {
        method: 'POST',
        body: { email: a.email, password: a.password, email_confirm: true, app_metadata: a.appMetadata },
      })) as { id?: unknown } | null;
      if (typeof user?.id !== 'string') throw new Error(`the auth service created ${a.loginId} but returned no id`);
      await call('/rest/v1/membership', { method: 'POST', body: { org_id: a.orgId, user_id: user.id, role: a.kind } });
      await call('/rest/v1/account', {
        method: 'POST',
        profile: 'lms',
        body: { org_id: a.orgId, user_id: user.id, login_id: a.loginId, kind: a.kind, display_name: a.displayName },
      });
      return user.id;
    },

    async ensureTeaching(org, section, subject, teacher) {
      await call('/rest/v1/teaching_assignment?on_conflict=section_id,subject_id,teacher_user_id', {
        method: 'POST',
        profile: 'lms',
        prefer: 'resolution=ignore-duplicates',
        body: { org_id: org, section_id: section, subject_id: subject, teacher_user_id: teacher },
      });
    },

    async activeEnrolment(year, student) {
      const sectionId = firstId(
        await call(
          `/rest/v1/enrolment?academic_year_id=eq.${year}&student_user_id=eq.${student}&left_on=is.null&select=section_id`,
          { profile: 'lms' },
        ),
        'section_id',
      );
      if (!sectionId) return null;
      const rows = (await call(`/rest/v1/section?id=eq.${sectionId}&select=grade,name`, { profile: 'lms' })) as {
        grade: number;
        name: string;
      }[];
      return { sectionId, grade: rows[0].grade, name: rows[0].name };
    },

    async enrol(org, year, section, student, roll) {
      await call('/rest/v1/enrolment', {
        method: 'POST',
        profile: 'lms',
        body: { org_id: org, academic_year_id: year, section_id: section, student_user_id: student, roll_number: roll },
      });
    },
  };
}
