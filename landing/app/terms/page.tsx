import Link from 'next/link'
import { LegalPage, Section } from '@/components/LegalPage'

/**
 * Same standard as the privacy page: only what is true today, and the prize
 * terms deliberately do NOT invent things nobody has decided.
 *
 * NOT REVIEWED BY A LAWYER. The contest states a ₹1,00,000+ prize pool on the
 * home page and nothing in this repo backs that with a funded account, a date,
 * or a judging rule — so the sections below say who decides and by when in the
 * vaguest honest terms available, and Aarav has to fill those in before a
 * single real entry is taken. Publishing a prize contest with no stated
 * closing date or judging basis is the part that bites.
 */
export const metadata = {
  title: 'Terms & Conditions | Qrie',
  description: 'The terms for using Qrie and for entering the Champion League.',
}

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="The rules,"
      accent="in plain words."
      updated="25 September 2026"
      lede="Qrie is built for students in classes 6 to 12. These terms cover using the tutor and entering the Champion League."
    >
      <Section title="Who may use Qrie">
        <p>
          Qrie is for school students in classes 6 to 12. If you are under 18, a
          parent or guardian must agree to these terms before you use it.
        </p>
      </Section>

      <Section title="What Qrie is, and is not">
        <p>
          Qrie is an AI tutor. It explains, asks questions and adapts to what you
          answer. Like any AI, <b>it can be wrong</b>. Do not treat it as the final
          word on an exam answer, and tell us when it gets something wrong — there
          is a report button in every class.
        </p>
        <p>
          Qrie is not a substitute for school, and it does not guarantee any
          result in any examination.
        </p>
      </Section>

      <Section title="Your account and your work">
        <p>
          The work you do stays yours. You can delete your account and everything
          attached to it at any time from Settings, as described in the{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
        <p>
          Do not share your account with anyone else. If you use Qrie on a shared
          phone, sign out when you are done.
        </p>
      </Section>

      <Section title="The Champion League">
        <p>
          Entry is free and open to students in classes 6 to 12 in India. One entry
          per student — submitting the form again updates your entry rather than
          creating a second one.
        </p>
        <p>
          Entries must be truthful. We may disqualify an entry where the details
          given are not the entrant&apos;s own, or where the same student has entered
          more than once under different accounts.
        </p>
        <p>
          <b>Closing date, judging and prize despatch have not been announced yet.</b>{' '}
          They will be published on this page before entries close, and they will
          apply to every entry already received.
        </p>
        <p>
          A postal address is asked for so that a prize can be sent. It is used for
          nothing else.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If these terms change in a way that affects you, the date at the top of
          this page changes with them.
        </p>
      </Section>

      <Section title="Contact">
        <p>Write to <b>hello@curie.study</b>.</p>
      </Section>
    </LegalPage>
  )
}
