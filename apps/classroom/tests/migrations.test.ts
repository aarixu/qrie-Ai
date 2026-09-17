import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_VERSION } from '@ai-tutor/learner-model';
import { REQUESTS_PER_MINUTE, UNITS, UNITS_PER_DAY, UNITS_PER_DAY_PROJECT } from '@ai-tutor/relay';

/**
 * THE POLICY MUST EXIST AS A MIGRATION, NOT AS A COMMENT.
 *
 * It used to live only in a docstring in supabase.ts, which is not a
 * permission: until it runs on the project, the anon key that ships in the
 * bundle can select the whole table. These tests cannot reach the live
 * project — that check is a human one — but they can stop the migration from
 * being quietly deleted or weakened, which is how this kind of thing is
 * actually lost.
 */

const dir = path.resolve(process.cwd(), 'supabase/migrations');
const sqlOf = (file: string): string => fs.readFileSync(path.join(dir, file), 'utf8');

describe('the student_state migration', () => {
  const sql = sqlOf('0001_student_state.sql');

  it('creates the table with the composite key the client upserts on', () => {
    expect(sql).toMatch(/create table if not exists public\.student_state/i);
    expect(sql).toMatch(/primary key \(user_id, key\)/i);
  });

  it('cascades the work away with the account', () => {
    expect(sql).toMatch(/references auth\.users on delete cascade/i);
  });

  it('turns row level security ON', () => {
    expect(sql).toMatch(/alter table public\.student_state enable row level security/i);
  });

  it('lets a student touch only their own rows, on read AND on write', () => {
    // `using` guards what can be read; `with check` guards what can be
    // written. A policy with only the first lets one student write rows
    // under another student's id.
    expect(sql).toMatch(/using \(auth\.uid\(\) = user_id\)/i);
    expect(sql).toMatch(/with check \(auth\.uid\(\) = user_id\)/i);
  });
});

describe('the account deletion migration', () => {
  const sql = sqlOf('0002_deleted_account.sql');

  it('deletes the auth user, not merely their rows', () => {
    expect(sql).toMatch(/delete from auth\.users/i);
  });

  it('refuses when nobody is signed in, rather than deleting by null', () => {
    expect(sql).toMatch(/auth\.uid\(\) is null/i);
    expect(sql).toMatch(/raise exception/i);
  });

  it('deletes only the caller', () => {
    expect(sql).toMatch(/where id = auth\.uid\(\)/i);
  });

  it('is callable by a signed-in student and nobody else', () => {
    expect(sql).toMatch(/revoke all on function public\.delete_own_account\(\) from public/i);
    expect(sql).toMatch(/grant execute on function public\.delete_own_account\(\) to authenticated/i);
  });
});

describe('the tenancy migration', () => {
  const sql = sqlOf('0005_tenancy.sql');

  it('gives every role the LMS will need, so the check is not altered later', () => {
    expect(sql).toMatch(/check \(role in \('admin', 'teacher', 'student'\)\)/i);
  });

  it('resolves membership through a definer function, or RLS recurses forever', () => {
    // A policy on `membership` that reads `membership` recurses until Postgres
    // gives up. This function is the way out, and it only works as definer.
    expect(sql).toMatch(/create or replace function public\.is_member/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/using \(public\.is_member\(org_id\)\)/i);
  });

  it('provisions the org in Postgres, not in the app', () => {
    // Anonymous sign-in never passes through app code we control, and the
    // ledger needs an org on the student's very first event.
    expect(sql).toMatch(/create trigger on_auth_user_created/i);
    expect(sql).toMatch(/after insert on auth\.users/i);
  });

  it('lets nobody write their own tenancy from a browser', () => {
    // Membership is what every ledger policy trusts. A student who could write
    // it could seat themselves inside someone else's school.
    expect(sql).not.toMatch(/create policy[^;]*on public\.membership\s+for (insert|update|delete)/i);
    expect(sql).not.toMatch(/create policy[^;]*on public\.organization\s+for (insert|update|delete)/i);
  });

  it('backfills accounts that existed before it, or they can never write an event', () => {
    expect(sql).toMatch(/from auth\.users u/i);
    expect(sql).toMatch(/not exists \(select 1 from public\.membership/i);
  });
});

describe('the ledger migration', () => {
  const sql = sqlOf('0006_ledger.sql');

  it('takes the id from the device instead of generating one', () => {
    // The client mints it when the event happens, and it is the primary key —
    // which is what makes replaying a half-failed drain a no-op instead of a
    // duplicate answer inflating mastery.
    expect(sql).toMatch(/id uuid primary key,/i);
    expect(sql).not.toMatch(/id uuid primary key default/i);
  });

  it('is APPEND-ONLY, enforced by the absence of a policy', () => {
    // The learner model is rebuilt from these rows. A student who could edit
    // them could edit what the system believes about them.
    expect(sql).toMatch(/for select using \(auth\.uid\(\) = user_id\)/i);
    expect(sql).toMatch(/for insert with check/i);
    expect(sql).not.toMatch(/on public\.ledger_event[\s\S]{0,80}for (update|delete)/i);
    expect(sql).not.toMatch(/on public\.learning_session[\s\S]{0,80}for (update|delete)/i);
  });

  it('pins an insert to both the caller and their organization', () => {
    // user_id alone would let a student file answers into someone else's school.
    expect(sql).toMatch(/with check \(auth\.uid\(\) = user_id and public\.is_member\(org_id\)\)/i);
  });

  it('cannot be made to hold two events at one position in a session', () => {
    expect(sql).toMatch(/create unique index[\s\S]{0,80}ledger_event \(session_id, seq\)/i);
  });

  it('keeps both clocks, because a phone clock cannot be trusted', () => {
    expect(sql).toMatch(/at timestamptz not null,/i);
    expect(sql).toMatch(/received_at timestamptz not null default now\(\)/i);
  });

  it('records time ON TASK, which the primary metric divides by', () => {
    expect(sql).toMatch(/active_ms integer/i);
  });

  it('closes a session through a function, and only once', () => {
    expect(sql).toMatch(/create or replace function public\.close_learning_session/i);
    expect(sql).toMatch(/and ended_at is null/i);
    expect(sql).toMatch(/grant execute on function public\.close_learning_session/i);
  });

  /**
   * AND THE "ONLY ONCE" ABOVE WAS NOT TRUE UNTIL 0011.
   *
   * `and ended_at is null` guarded a statement that wrote
   * `ended_at = p_ended_at`. A call passing null wrote active_ms and left the
   * sitting open, so the guard never armed and the next call was admitted as
   * readily as the first. Measured against the deployed project: one sitting,
   * four accepted calls, 92 000 ms then 36 000 000 then 2 147 483 647 then
   * null — and active_ms is the denominator of the primary metric and of
   * cost_per_student_hour, which is to say of the bill.
   */
  describe('and the guard on that function, which only 0011 made unwalkable', () => {
    // With the `--` prose stripped. 0011's header quotes the statement it is
    // replacing, and an assertion a comment can satisfy — or fail — is an
    // assertion about prose rather than about what Postgres will run.
    const fix = sqlOf('0011_close_session_once.sql').replace(/--[^\n]*/g, '');

    it('cannot write the open state that its own guard looks for', () => {
      // The guard's precondition is established by the statement the guard
      // admits: every accepted call leaves ended_at non-null, so a second call
      // finds a closed sitting whatever arguments it carries.
      expect(fix).toMatch(/set ended_at = coalesce\(p_ended_at, now\(\)\)/i);
      expect(fix).not.toMatch(/set ended_at = p_ended_at/i);
      expect(fix).toMatch(/and ended_at is null/i);
    });

    it('refuses a null or negative time on task instead of counting it as none', () => {
      // Coalescing a null to 0 would have been the quiet option and it would
      // have written a lie into the denominator rather than rejecting a call.
      expect(fix).toMatch(/p_active_ms is null or p_active_ms < 0/i);
      expect(fix).toMatch(/raise exception/i);
    });

    it('leaves a repeat close a silent no-op, because the outbox replays', () => {
      // A drain whose response was lost re-sends its batch; replay being free
      // is what the offline outbox rests on. Raising on an already-closed
      // sitting would hold that row and retry it for the life of the install.
      expect(fix.match(/raise exception/gi)?.length).toBe(1);
    });

    it('keeps the definer and the pinned search_path that make it safe to be one', () => {
      // There is no update policy on learning_session, so this function is the
      // only writer and has to be definer; a definer function without a pinned
      // search_path is an escalation waiting for a schema on the path.
      expect(fix).toMatch(/security definer/i);
      expect(fix).toMatch(/set search_path = public/i);
      expect(fix).toMatch(/user_id = auth\.uid\(\)/i);
    });

    it('is callable by the student who owns the sitting and by nobody else', () => {
      // `revoke from public` does not touch the grant Supabase hands anon on
      // functions created in public. Before this migration a call carrying only
      // the anon key — nobody signed in — returned 204, not permission denied.
      expect(fix).toMatch(/revoke all on function public\.close_learning_session\(uuid, timestamptz, integer\) from public/i);
      expect(fix).toMatch(/revoke all on function public\.close_learning_session\(uuid, timestamptz, integer\) from anon/i);
      expect(fix).toMatch(/grant execute on function public\.close_learning_session\(uuid, timestamptz, integer\) to authenticated/i);
    });

    it('replaces the function instead of dropping and recreating it', () => {
      // A drop takes the ACL with it and leaves every phone's close answered
      // 404 for as long as the recreate takes.
      expect(fix).not.toMatch(/drop function/i);
    });
  });
});

/**
 * THE DAY'S BUDGET LIVES IN TWO FILES, AND ONLY A COMMENT KEPT THEM IN STEP.
 *
 * `admit` prices a call in gate.ts and hands the number to `claim_relay`, which
 * holds the ceiling itself — so the prices can move alone but the CEILING
 * cannot. 0012's own header says what happens if it does: a measured class now
 * weighs about 1,579 units against the old ceiling of 3,000, so shipping the
 * repriced units with the old budget refuses a student partway through their
 * second class, and the refusal reads "You have used up today's classes."
 *
 * That is exactly the drift this file exists to catch, and it was the one pair
 * nothing checked.
 */
describe('the day budget, which is written down twice', () => {
  const sql = sqlOf('0012_reprice_relay_units.sql').replace(/--[^\n]*/g, '');

  it('is the same number in the database as in the code that spends against it', () => {
    const inSql = /units_per_day\s+constant\s+integer\s*:=\s*(\d+)/i.exec(sql);
    expect(inSql).not.toBeNull();
    expect(Number(inSql![1])).toBe(UNITS_PER_DAY);
  });

  it('and so is the per-minute ceiling, for the same reason', () => {
    const inSql = /requests_per_minute\s+constant\s+integer\s*:=\s*(\d+)/i.exec(sql);
    expect(inSql).not.toBeNull();
    expect(Number(inSql![1])).toBe(REQUESTS_PER_MINUTE);
  });

  it('still lets a whole cached class through, which is the failure that ships silently', () => {
    // Every claim in a class is allowed; a budget too small shows up only once
    // enough of them have added up, which is to say mid-lesson.
    const cachedClass =
      Math.max(1, Math.ceil(2_964 * UNITS.speech.units)) + 8 * UNITS.llm.units + 32 + UNITS.icons.units;
    expect(cachedClass).toBeLessThan(UNITS_PER_DAY);
  });

  it('leaves the claim atomic and closed to students, because replace takes the whole body', () => {
    expect(sql).toMatch(/insert into public\.relay_usage[\s\S]*on conflict \(user_id\) do update/i);
    expect(sql).toMatch(/grant execute on function public\.claim_relay\(uuid, text, integer\) to service_role/i);
    expect(sql).toMatch(/revoke all on function public\.claim_relay\(uuid, text, integer\) from authenticated/i);
  });
});

describe('the retention migration', () => {
  const sql = sqlOf('0007_retention.sql');

  it('takes the empty solo org with the last member who left it', () => {
    // ledger_event and learning_session already cascaded from auth.users, but
    // the org created by the 0005 trigger referenced nothing that does — so
    // deleting an account left a row behind forever.
    expect(sql).toMatch(/create trigger on_membership_removed/i);
    expect(sql).toMatch(/after delete on public\.membership/i);
    expect(sql).toMatch(/and o\.kind = 'solo'/i);
  });

  it('leaves a school with no members alone', () => {
    // A school between terms is not rubbish.
    expect(sql).toMatch(/o\.kind = 'solo'/i);
    expect(sql).not.toMatch(/delete from public\.organization[\s\S]{0,200}kind = 'school'/i);
  });

  it('ages rows by the SERVER clock, never the phone', () => {
    // A device set to 2019 would have its events purged on arrival.
    expect(sql).toMatch(/where received_at < cutoff/i);
    expect(sql).not.toMatch(/where at < cutoff/i);
  });

  it('never orphans half a session', () => {
    expect(sql).toMatch(/not exists \(select 1 from public\.ledger_event e where e\.session_id = s\.id\)/i);
  });

  it('is an operator tool and unreachable from a browser', () => {
    // A purge a student could call is a purge a student could call with 1 day.
    expect(sql).toMatch(/revoke all on function public\.purge_old_ledger\(integer\) from anon/i);
    expect(sql).toMatch(/revoke all on function public\.purge_old_ledger\(integer\) from authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.purge_old_ledger\(integer\) to service_role/i);
  });

  it('refuses a zero or negative window', () => {
    expect(sql).toMatch(/greatest\(p_days, 1\)/i);
  });

  /**
   * The half that was missing: 0007 wrote a correct, locked-down, indexed
   * purge and NOTHING CALLED IT. Retention was recorded as shipped in the plan
   * while the database kept every answer a child had ever written. A window
   * that exists only in a comment is worse than making no claim at all.
   */
  describe('and the schedule that actually runs it', () => {
    const cron = sqlOf('0009_retention_schedule.sql');

    it('schedules the purge daily, in the database', () => {
      expect(cron).toMatch(/create extension if not exists pg_cron/i);
      expect(cron).toMatch(/cron\.schedule\(/i);
      expect(cron).toMatch(/select public\.purge_old_ledger\(90\)/i);
    });

    it('runs it at an hour no Indian student is in class', () => {
      // 19:30 UTC is 01:00 IST.
      expect(cron).toMatch(/'30 19 \* \* \*'/);
    });

    it('can be applied twice without racing itself', () => {
      expect(cron).toMatch(/cron\.unschedule\('purge-old-ledger'\)/i);
    });

    /**
     * Scheduled INSIDE Postgres on purpose. The alternative is a service_role
     * key — which can read and delete every student's record — parked in a
     * third-party scheduler to run one statement a day.
     */
    it('needs no key to leave the database', () => {
      expect(cron).not.toMatch(/service_role_key|SUPABASE_SERVICE|curl /i);
    });
  });
});

/**
 * RLS ON A TABLE DOES NOT REACH A VIEW BUILT OVER IT.
 *
 * usage_event's own-rows policy worked from the day it shipped. usage_cost
 * selects from usage_event, and a Postgres view runs with the rights of
 * whoever DEFINED it unless it says otherwise — so the view read every
 * student's rows, and Supabase grants select on new objects in public to
 * authenticated by default. Measured against the deployed project: a
 * brand-new anonymous account read five other students' rows through the
 * view while reading none through the table.
 */
describe('the view that leaked every student’s spend', () => {
  const sql = sqlOf('0010_usage_cost_rls.sql');

  it('makes the view run as its caller, so row security applies to it', () => {
    expect(sql).toMatch(/alter view public\.usage_cost set \(security_invoker = true\)/i);
  });

  it('and closes it to students outright, because it is an operator report', () => {
    expect(sql).toMatch(/revoke all on public\.usage_cost from anon/i);
    expect(sql).toMatch(/revoke all on public\.usage_cost from authenticated/i);
    expect(sql).toMatch(/grant select on public\.usage_cost to service_role/i);
  });

  it('closes session_cost too, which read the same view and nobody had revoked', () => {
    expect(sql).toMatch(/revoke all on function public\.session_cost\(uuid\) from authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.session_cost\(uuid\) to service_role/i);
  });
});

describe('the usage migration', () => {
  const sql = sqlOf('0008_usage.sql');

  it('holds quantities, never prices', () => {
    // A token is a fact about a call. A rupee per token is a fact about a
    // contract that changes without telling us; it lives in its own table.
    expect(sql).toMatch(/create table if not exists public\.model_price/i);
    // The usage_event TABLE itself - not the file, which rightly mentions
    // rupees in the view that joins the two - carries no price column.
    const table = sql.match(/create table if not exists public\.usage_event \(([\s\S]*?)\n\);/i);
    expect(table).not.toBeNull();
    expect(table![1]).not.toMatch(/inr|price|rupee/i);
    expect(table![1]).toMatch(/prompt_tokens integer/i);
  });

  it('keeps price history so a change re-prices only what came after', () => {
    expect(sql).toMatch(/effective_from timestamptz not null default now\(\)/i);
    expect(sql).toMatch(/primary key \(provider, model, unit, effective_from\)/i);
    expect(sql).toMatch(/order by effective_from desc/i);
  });

  it('is written by the relay alone', () => {
    // A student who could write their own usage could write their own bill.
    expect(sql).toMatch(/revoke all on function public\.record_usage[^;]*from anon/i);
    expect(sql).toMatch(/revoke all on function public\.record_usage[^;]*from authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.record_usage[^;]*to service_role/i);
    expect(sql).not.toMatch(/on public\.usage_event\s+for insert/i);
  });

  it('shows an unpriced call as unpriced, never as free', () => {
    expect(sql).toMatch(/as unpriced/i);
    expect(sql).toMatch(/unpriced_calls/i);
  });

  it('divides by time ON TASK, not wall clock', () => {
    // The headline number is rupees per hour of a student actually learning.
    expect(sql).toMatch(/create or replace function public\.cost_per_student_hour/i);
    expect(sql).toMatch(/active_ms is not null and active_ms > 0/i);
    expect(sql).toMatch(/sum\(c\.active_ms\) \/ 3600000\.0/i);
  });

  it('does not refuse a usage row because the session row has not landed yet', () => {
    // The drain writes learning_session after the calls that belonged to it.
    expect(sql).toMatch(/session_id uuid,/i);
    expect(sql).not.toMatch(/session_id uuid[^,]*references/i);
  });
});

describe('the learner model migration', () => {
  const sql = sqlOf('0013_learner_model.sql');

  it('keys belief by the student and the outcome', () => {
    expect(sql).toMatch(/create table if not exists public\.concept_state/i);
    expect(sql).toMatch(/primary key \(user_id, outcome_id\)/i);
  });

  it('carries org_id, so a school can be given access without a migration', () => {
    // Adding is_member(org_id) later is then a policy change rather than a
    // migration across a table holding every student's beliefs.
    expect(sql).toMatch(/org_id uuid not null references public\.organization/i);
  });

  /**
   * THE PROPERTY THAT MAKES BELIEF EVIDENCE RATHER THAN A PREFERENCE.
   *
   * A student who can write their own mastery has not been measured, they have
   * been asked. There is no insert, update or delete policy and the ABSENCE is
   * the point: RLS denies what nothing allows, so the only writer is
   * service_role through the fold. Deliberately stricter than student_state,
   * whose policy is `for all`.
   */
  it('lets a student read their own belief and never write it', () => {
    expect(sql).toMatch(
      /create policy "a student reads their own concept state" on public\.concept_state\s+for select to authenticated using \(auth\.uid\(\) = user_id\)/i,
    );
    expect(sql).not.toMatch(/on public\.concept_state\s+for (all|insert|update|delete)/i);
    expect(sql).toMatch(
      /revoke insert, update, delete on public\.concept_state from authenticated/i,
    );
  });

  it('closes both tables to anon, because Supabase opens new ones by default', () => {
    // 0010 found this the hard way: a view handed a brand-new anonymous account
    // five other students' spend, by default rather than by mistake.
    expect(sql).toMatch(/revoke all on public\.concept_state from anon/i);
    expect(sql).toMatch(/revoke all on public\.learner_model from anon/i);
  });

  it('locks learner_model down exactly as hard as concept_state', () => {
    // The 2026-09-16 audit found this table's write-deny asserted less strictly
    // than its sibling's: the cursor row is as much a measurement as the belief
    // rows are, and a student who can move their own fold cursor can replay
    // events into double-counted belief.
    expect(sql).toMatch(
      /create policy "a student reads their own model row" on public\.learner_model\s+for select to authenticated using \(auth\.uid\(\) = user_id\)/i,
    );
    expect(sql).not.toMatch(/on public\.learner_model\s+for (all|insert|update|delete)/i);
    expect(sql).toMatch(
      /revoke insert, update, delete on public\.learner_model from authenticated/i,
    );
  });

  it('indexes the outcome ids the inspector reads evidence by', () => {
    // ledger_event.outcome_ids had no index of any kind, and "what evidence is
    // behind this outcome" is the question the whole model exists to answer.
    expect(sql).toMatch(/on public\.ledger_event using gin \(outcome_ids\)/i);
  });

  it('keeps the model version in step with the code that writes it', () => {
    // The same drift check the day budget has, for the same reason: two places
    // hold this number and only one of them is tested by anything else.
    const inSql = /version integer not null default (\d+)/i.exec(sql);
    expect(inSql).not.toBeNull();
    expect(Number(inSql![1])).toBe(MODEL_VERSION);
  });
});

describe('the evidence-columns migration', () => {
  const sql = sqlOf('0014_concept_state_evidence_columns.sql');

  it('adds the two columns the evidence gate reads', () => {
    // evidenceSet (packages/learner-model/src/project.ts) decides which
    // outcomes the model may hold an opinion about by reading
    // answerObservations and doubtCount. 0013 shipped without either column,
    // so a server fold persisting through concept_state and reloading would
    // silently drop the gate — the 0.46 defect back in through a round-trip.
    expect(sql).toMatch(
      /add column if not exists answer_observations integer not null default 0/i,
    );
    expect(sql).toMatch(/add column if not exists doubt_count integer not null default 0/i);
  });
});

/**
 * THE CEILING ON OUR SPENDING, WHICH IS A DIFFERENT QUESTION FROM THEIRS.
 *
 * Every limit 0012 holds is keyed on one user, and a user costs nothing to
 * create: the app signs in anonymously at boot with no captcha anywhere near
 * it. So the ceiling a script meets is Rs 120 a day multiplied by however many
 * accounts it mints, which is not a ceiling. 0015 puts a line under the whole
 * project, and it has to be claimed in the same function and the same
 * transaction as the per-user one, or two Edge Function instances can both
 * read the last unit.
 */
describe('the project-wide ceiling', () => {
  const sql = sqlOf('0015_project_spend_cap.sql').replace(/--[^\n]*/g, '');

  it('still carries the number it shipped with, which 0016 then took over', () => {
    // FROZEN, not mirrored. 0015 held the ceiling in a plpgsql constant and
    // 0016 replaced that with `relay_control.global_units_per_day`, so this
    // migration no longer decides anything. Asserting it against the live
    // `UNITS_PER_DAY_PROJECT` would mean that raising the ceiling turns a
    // superseded migration red, and whoever raised it would spend ten minutes
    // reading a file that is only history. The live assertion is 0016's, on
    // the column DEFAULT.
    const inSql = /units_per_day_project\s+constant\s+integer\s*:=\s*(\d+)/i.exec(sql);
    expect(inSql).not.toBeNull();
    expect(Number(inSql![1])).toBe(50_000);
  });

  it('sits above the per-student ceiling, so one student can never trip it', () => {
    expect(UNITS_PER_DAY_PROJECT).toBeGreaterThan(UNITS_PER_DAY);
  });

  it('claims the day in ONE guarded statement, so the last unit cannot go twice', () => {
    // An insert that reads, then an update that writes, is two statements and a
    // race. The guard has to be the WHERE of the upsert itself: if the row that
    // comes back is missing, the day is spent.
    expect(sql).toMatch(
      /insert into public\.relay_budget_day[\s\S]*on conflict \(day\) do update[\s\S]*where[\s\S]*units_per_day_project/i,
    );
  });

  it('refuses with its own reason, because the student did not do this', () => {
    expect(sql).toMatch(/'capped'/);
  });

  it('is closed to students, like every other privileged function', () => {
    expect(sql).toMatch(/alter table public\.relay_budget_day enable row level security/i);
    expect(sql).toMatch(
      /grant execute on function public\.claim_relay\(uuid, text, integer\) to service_role/i,
    );
  });

  it('replaces claim_relay rather than dropping it, so the grant survives', () => {
    expect(sql).toMatch(/create or replace function public\.claim_relay/i);
    expect(sql).not.toMatch(/drop function/i);
  });
});

/**
 * THE CEILING MOVES WITHOUT A MIGRATION, OR IT TAKES THE PILOT DOWN WITH IT.
 *
 * 0015 put the project ceiling in a plpgsql constant, so raising it is a
 * migration and a deploy. Rs 500 a day is right for a self-serve MVP and wrong
 * for the school pilot by roughly four times: 500 bound students at about ten
 * minutes each is around 83 student-hours a day, which at MVP-1 rates is about
 * Rs 2,158. The pilot would halt at breakfast on its first morning and the fix
 * would be a migration written in a hurry.
 *
 * So the number becomes a row, and the constant becomes that row's DEFAULT.
 * `halted` sits beside it: the same stop as `RELAY_DISABLED`, inside the
 * database, where an alarm can set it with nobody awake to deploy.
 */
describe('relay_control, so the ceiling is a row and not a migration', () => {
  const sql = sqlOf('0016_relay_control.sql').replace(/--[^\n]*/g, '');

  it('defaults to exactly the ceiling the code still names', () => {
    const inSql = /global_units_per_day\s+integer\s+not null\s+default\s+(\d+)/i.exec(sql);
    expect(inSql).not.toBeNull();
    expect(Number(inSql![1])).toBe(UNITS_PER_DAY_PROJECT);
  });

  it('can only ever hold one row', () => {
    // A control table with two rows is a control table nobody can reason about.
    expect(sql).toMatch(/id\s+boolean\s+primary key\s+default\s+true\s+check\s*\(\s*id\s*\)/i);
  });

  it('starts with that row already in it', () => {
    // A missing row must not be the thing that decides whether the relay runs.
    expect(sql).toMatch(/insert into public\.relay_control[\s\S]*on conflict[\s\S]*do nothing/i);
  });

  it('reads the row instead of the constant it replaces', () => {
    expect(sql).toMatch(/create or replace function public\.claim_relay/i);
    expect(sql).toMatch(/from public\.relay_control/i);
    // The 0015 constant is gone from the body, or the row changes nothing.
    expect(sql).not.toMatch(/units_per_day_project\s+constant/i);
  });

  it('answers halted with its own reason, not as a spent budget', () => {
    expect(sql).toMatch(/'halted'/);
  });

  it('is closed to students, like every other control surface', () => {
    expect(sql).toMatch(/alter table public\.relay_control enable row level security/i);
    expect(sql).toMatch(/revoke all on table public\.relay_control from/i);
  });

  it('carries the concurrency ceiling the prep lock will need', () => {
    expect(sql).toMatch(/max_concurrent_preps\s+integer\s+not null\s+default\s+\d+/i);
  });
});

/**
 * S IS THE WHOLE COST MODEL, AND WITHOUT A LOCK IT IS ONE.
 *
 * Preparation contributes `16.55 x Rs 30 / S` to the student-hour, where S is
 * the number of students sharing a topic. At S = 1 that is Rs 496.5 a
 * student-hour, ninety-nine times the ceiling, and it is the DEFAULT state of a
 * self-serve student on a cold topic: preparation runs in the student's own
 * browser, every limit is keyed on one user, and nothing anywhere holds a
 * semaphore. N students opening one cold topic run N preparations and throw
 * N-1 of the results away, which is the arithmetic running backwards.
 *
 * It is also what breaks first: roughly forty relay calls per preparation, no
 * queue, and a burst of simultaneous cold preps against one project ceiling.
 */
describe('the per-topic prep lock', () => {
  const sql = sqlOf('0017_prep_lock.sql').replace(/--[^\n]*/g, '');

  it('is keyed on the topic, never on a derived class id', () => {
    // Two students reaching one topic by different derivations must take ONE
    // lock. A key derived per client is two locks and no lock.
    expect(sql).toMatch(/create table[\s\S]*public\.prep_lock[\s\S]*topic_ref\s+text\s+primary key/i);
  });

  it('expires, because a browser that closed mid-prep releases nothing', () => {
    expect(sql).toMatch(/expires_at\s+timestamptz\s+not null/i);
    expect(sql).toMatch(/delete from public\.prep_lock[\s\S]*expires_at\s*<\s*/i);
  });

  it('wins or loses in one statement, so two students cannot both win', () => {
    expect(sql).toMatch(/insert into public\.prep_lock[\s\S]*on conflict \(topic_ref\) do nothing/i);
  });

  it('refuses with busy when too many preparations are already running', () => {
    expect(sql).toMatch(/'busy'/);
    expect(sql).toMatch(/max_concurrent_preps/i);
  });

  it('reads its concurrency ceiling from the row, not from a constant', () => {
    expect(sql).toMatch(/from public\.relay_control/i);
  });

  it('can be released by its holder and nobody else', () => {
    expect(sql).toMatch(/create or replace function public\.release_prep_lock/i);
    expect(sql).toMatch(/where[\s\S]*topic_ref\s*=\s*p_topic[\s\S]*user_id\s*=\s*p_user/i);
  });

  it('is closed to students, who reach it only through the relay', () => {
    expect(sql).toMatch(/alter table public\.prep_lock enable row level security/i);
    expect(sql).toMatch(
      /grant execute on function public\.take_prep_lock\([^)]*\) to service_role/i,
    );
    expect(sql).toMatch(/revoke all on function public\.take_prep_lock\([^)]*\) from/i);
  });
});
