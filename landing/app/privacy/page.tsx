import Link from 'next/link'
import { LegalPage, Section } from '@/components/LegalPage'

/**
 * WRITTEN FROM THE CODE, NOT FROM A TEMPLATE — AND NOT YET REVIEWED.
 *
 * Every claim below was checked against what actually runs: the columns in
 * supabase/migrations/0020, the telemetry rules in
 * apps/classroom/src/lib/telemetry.ts, and the retention job in migrations
 * 0007 and 0009. Nothing here describes an intention; where the product does
 * not do a thing yet, this says so rather than promising it.
 *
 * RE-CHECKED 2026-09-29, and two things it said were wrong:
 *
 *   - It named no model vendor. Wherever the relay has a Google service
 *     account, packages/relay/src/handler.ts sends /api/llm, /api/speech and
 *     /api/hear to Vertex and makes no OpenRouter call at all; production has
 *     run that way since 2026-09-29. OpenRouter (and, through it, Deepgram's
 *     aura-2 voice and nova-3 ear) is kept only for a laptop with no service
 *     account, so it appears here only in the past tense. Vertex is called at
 *     location `global` (packages/relay/src/vertex.ts), hence "may be handled
 *     outside India". Class preparation also searches Wikimedia Commons from
 *     the browser (apps/classroom/src/lib/liveClass.ts).
 *   - It said "class and usage records are deleted automatically after 90
 *     days". `purge_old_ledger` deletes from ledger_event and learning_session
 *     only; usage_event, student_state, student_report and contest_signup have
 *     no window and go with the account (every one cascades from auth.users).
 *
 * AND THE FIRST CORRECTION UNDER-REPORTED GOOGLE. It said a class was
 * prepared from "the topic and the class it is for". The planner prompt also
 * carries every line apps/classroom/src/lib/student.ts `studentLinesForPlanner`
 * writes (right and wrong answers, raised hands, what is held and what is
 * shaky, the streak, the last class), and a page the student brought goes in
 * whole through lib/sourceText.ts `plannerTopicFromSource`. The doubt tutor is
 * sent `buildStudentContext` (class, streak, hands raised, mastery). All of it
 * reaches Vertex through /api/llm. The Vertex paragraph now says each of
 * these, and the test builds the real lines and fails on any kind of line the
 * paragraph does not own up to.
 *
 * Sentry and PostHog are described as switched off unless configured because
 * that is what telemetry.ts does: nothing is sent unless VITE_SENTRY_DSN or
 * VITE_POSTHOG_KEY is set at build time. Whether production sets either is
 * not recorded in this repo — UNVERIFIED — so the page describes the rule, not
 * the state. Vercel's visit counter is the <Analytics /> in app/layout.tsx,
 * rendered in production on the Next pages only; the tutor at /app is static
 * files copied into public/ and does not carry it. Whether Web Analytics is
 * switched on in the Vercel project, so that the counter records anything, is
 * a dashboard setting this repo cannot show — UNVERIFIED — which is why the
 * page says the pages "include" the counter rather than that visits are
 * counted.
 *
 * apps/classroom/tests/privacyClaims.test.tsx pins the parts a test can: the
 * vendors named, OpenRouter and Deepgram named and only in the past tense,
 * every "N days" equal to the window the cron job passes, the 200-character
 * answer cap (and that nothing kept is longer), no retention window stated
 * for usage records, and what Vertex is told about the student.
 *
 * "Neither is used for it now" is held by code, not by configuration: when
 * GOOGLE_SERVICE_ACCOUNT_JSON is set, supabase/functions/relay/index.ts gives
 * the handler no OpenRouter key (packages/relay/src/vendors.ts), so a broken
 * Google key answers 503 on thinking, voice and hearing rather than falling
 * back to OpenRouter. With the secret unset altogether the relay still uses
 * OpenRouter, as a laptop does — which is why deleting that secret in
 * production would make this page false.
 *
 * THAT IS NOT THE SAME AS BEING FIT TO PUBLISH. This is a factual description
 * of a system, not legal advice, and it has not been read by anybody
 * qualified. Before the contest takes a single real entry, Aarav needs to have
 * it reviewed against the DPDP Act 2023 — in particular the parental-consent
 * basis, which this product cannot currently satisfy because there is no SMS
 * verification, so the only thing standing behind "I am permitted to register
 * this student" is a child ticking a box.
 */
export const metadata = {
  title: 'Privacy Policy | Qrie AI',
  description: 'What Qrie collects, why, and how long it is kept.',
}

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="What we collect,"
      accent="and what we do not."
      updated="29 September 2026"
      lede="Qrie is used by school students, so this is written to be read rather than to be defended. Every section below describes what the software actually does today."
    >
      <Section title="What the contest form collects">
        <p>
          When you enter the Qrie Champion League at <Link href="/challenge-register">/challenge-register</Link>,
          we store: the student&apos;s name, their class, the student&apos;s mobile number,
          a parent or guardian&apos;s name and mobile number, a postal address, and
          whether the student takes tuition elsewhere.
        </p>
        <p>
          The postal address is collected <b>only</b> so a prize can be posted to a
          winner. It is never shown inside the app and is never used to decide
          anything about a student&apos;s learning.
        </p>
        <p>
          <b>The parent&apos;s number is not verified yet.</b> We do not send a
          confirmation code today, so we cannot prove that the person named as a
          parent agreed to anything. We store those two fields as what they are —
          text somebody typed — and we do not treat them as consent.
        </p>
      </Section>

      <Section title="What the app collects">
        <p>
          Opening the app creates an anonymous account automatically. It has no
          email and no phone number attached to it unless you choose to sign up
          later.
        </p>
        <p>
          Against that account we keep what is needed to teach: the name, class
          and subjects you give the app, which classes you opened, your progress,
          and any notes you write in a class. If you report something in a class,
          we keep the report so a person can read it.
        </p>
        <p>
          When you answer out loud, a speech service turns your voice into text.
          We never save the recording. For each answer, we keep what the tutor
          judged it to be and a short written copy of the answer, cut off at 200
          characters, so we can check she marked it fairly. If the safety check
          flags an answer, we keep none of its words. A note of what the safety
          check noticed stays on your device and is not sent to us.
        </p>
        <p>
          To teach you better, the tutor keeps a small notebook about you on your
          device: the hobbies you picked from a list, which topics of our own
          lessons felt hard or went well, what you raised your hand about (the
          topic, not your words), your last class, and the promise you chose at
          the end of it. We do not store it on our servers. When you ask a doubt,
          a few of its lines travel with your question through our server to
          Google Vertex AI, so the tutor can use them. Resetting your progress
          clears it (your hobbies stay until you change them); deleting your
          account, or a different signed-in student on the same phone, clears all
          of it. In a trial, nothing is written to it.
        </p>
      </Section>

      <Section title="How long it is kept">
        <p>
          The written copies of your answers, and the record of each class you
          sat, are deleted automatically 90 days after they reach us. A job
          inside the database does this every night.
        </p>
        <p>
          Records of how much each class used — which service was called and how
          much work it did, never your words — have no automatic deletion yet.
          That window is being finalised; until then they are deleted when your
          account is.
        </p>
        <p>
          Your account, your name, class and subjects, your progress, your notes,
          any report you sent and your contest entry are kept until you delete
          your account.
        </p>
      </Section>

      <Section title="Deleting everything">
        <p>
          Settings → Delete account removes the account and every row attached to
          it, including the contest entry, and clears the copy held on your device.
          It cannot be undone.
        </p>
        <p>
          You can also write to <b>hello@curie.study</b> and ask us to do it.
        </p>
      </Section>

      <Section title="Who else sees it">
        <p>
          Nobody buys this data and we do not sell it. These services handle it so
          the tutor can run:
        </p>
        <p>
          <b>Supabase</b> — our database and accounts, and the server that passes
          the tutor&apos;s requests on to Google.
        </p>
        <p>
          <b>Vercel</b> — hosts this website and the tutor app. This
          website&apos;s own pages, though not the tutor app, also include
          Vercel&apos;s counter of page visits.
        </p>
        <p>
          <b>Google Vertex AI</b> — the tutor&apos;s thinking, her voice and her
          hearing. To prepare a class it receives the topic, the class it is for,
          and a short summary of how you have been doing: which ideas you got
          right or wrong, what you raised a hand on, what you know well and what
          is still shaky, how many days in a row you have studied, and the last
          class you took — and, only for a page or topic of your own that is
          never kept for others, the hobbies you picked. If you bring your own page to learn from, it receives
          the words on that page. During a class it receives the lines she is
          about to say, so it can speak them; a recording of each answer you say
          out loud, so it can write it down; and what you ask or answer, so she
          can reply. When you ask a doubt, it also receives your class, how many
          days in a row you have studied, how many times you have raised a hand
          in that class, how well you seem to know what it teaches, and a few
          lines from your notebook: your hobbies, topics that felt hard or went
          well, what you raised a hand about, your last class and your promise. We do not
          send it your phone number, your address or your account. These requests
          go to Google&apos;s global service, so they may be handled outside India.
        </p>
        <p>
          <b>Wikimedia Commons</b> — when a new class is being prepared, the app
          searches this free picture library for photos of the topic, so Wikimedia
          receives those search words.
        </p>
        <p>
          <b>Sentry</b> (crash reports) and <b>PostHog</b> (usage counts) — the
          app can send to these, but they are switched off unless we turn them on.
          When they are on, reports are grouped by a random identifier made on
          your device and tied to nothing else. Usage counts carry numbers and
          short labels of our own, such as which screen was opened, and the app
          drops any text longer than 64 characters. Crash reports carry the error,
          where in the code it happened, and the page&apos;s address without
          anything after the &quot;?&quot;.
        </p>
        <p>
          Until late September 2026 some of this went through OpenRouter, which
          used Deepgram for her voice and her hearing. Neither is used for it now.
        </p>
      </Section>
    </LegalPage>
  )
}
