import Link from 'next/link'
import { LegalPage, Section } from '@/components/LegalPage'

/**
 * WRITTEN FROM THE CODE, NOT FROM A TEMPLATE — AND NOT YET REVIEWED.
 *
 * Every claim below was checked against what actually runs: the columns in
 * supabase/migrations/0020, the telemetry rules in
 * apps/classroom/src/lib/telemetry.ts, and the retention job in migration 0007.
 * Nothing here describes an intention; where the product does not do a thing
 * yet, this says so rather than promising it.
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
  title: 'Privacy Policy | Curie',
  description: 'What Curie collects, why, and how long it is kept.',
}

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="What we collect,"
      accent="and what we do not."
      updated="25 September 2026"
      lede="Curie is used by school students, so this is written to be read rather than to be defended. Every section below describes what the software actually does today."
    >
      <Section title="What the contest form collects">
        <p>
          When you enter the Curie Champion League at <Link href="/challenge-register">/challenge-register</Link>,
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
          name, no email and no phone number attached to it unless you choose to
          sign up later.
        </p>
        <p>
          Against that account we keep what is needed to teach: which classes you
          opened, the answers you gave in class, what the tutor judged them to be,
          your chosen class and subjects, and your progress. If you report
          something in a class, we keep the report so a person can read it.
        </p>
      </Section>

      <Section title="What never leaves the app">
        <p>
          Crash reports and usage counts are optional and are grouped by a random
          identifier created on your device that is connected to nothing else. We
          never send your name, your email, your account id, anything you typed, any
          answer you gave, or any part of a class transcript to those services.
        </p>
      </Section>

      <Section title="How long it is kept">
        <p>
          Class and usage records are deleted automatically after 90 days. Your
          account, your progress and your contest entry are kept until you delete
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
          Nobody buys this data and we do not sell it. To run the service we use
          Supabase (the database and accounts) and Vercel (this website). To prepare
          a class the tutor sends the topic and the question to a language-model
          provider; it does not send your name, your phone number or your address.
        </p>
      </Section>
    </LegalPage>
  )
}
