'use client'

import { useState } from 'react'
import Link from 'next/link'
import { saveEntry } from '@/lib/contest'
import { APP_URL } from '@/lib/app-url'
import { ART, imgProps } from '@/lib/art'


/**
 * FOUR STATES, BECAUSE THERE ARE FOUR THINGS THAT CAN BE TRUE.
 *
 * This page used to have two: a boolean that went true on submit and rendered
 * "Your details are saved for this challenge." It saved nothing — the handler
 * called setSubmitted(true) and stopped — so every entry in a ₹1,00,000
 * contest was destroyed on refresh while the parent was told it was kept.
 *
 * "saving" and "failed" are the two that were missing, and "failed" is the one
 * that matters: a network that drops must say so, in those words, rather than
 * inheriting the success screen.
 */
type State =
  | { at: 'idle' }
  | { at: 'saving' }
  | { at: 'saved' }
  | { at: 'failed'; message: string }

export default function ChallengeRegisterPage() {
  const [takesTuition, setTakesTuition] = useState('')
  const [state, setState] = useState<State>({ at: 'idle' })
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (!form.checkValidity() || !takesTuition) {
      setError('Please complete every required field and select a tuition option.')
      form.reportValidity()
      return
    }
    setError('')
    setState({ at: 'saving' })

    const data = new FormData(form)
    const text = (k: string) => String(data.get(k) ?? '')
    try {
      const saved = await saveEntry({
        studentName: text('studentName'),
        parentName: text('parentName'),
        studentMobile: text('studentMobile'),
        parentMobile: text('parentMobile'),
        klass: text('klass'),
        address: text('address'),
        takesTuition,
      })
      setState(saved.ok ? { at: 'saved' } : { at: 'failed', message: saved.problem })
    } catch {
      setState({
        at: 'failed',
        message: 'We could not reach Qrie. Nothing was saved — please check your connection.',
      })
    }
  }

  const saving = state.at === 'saving'

  return (
    <main className="register-page">
      <nav className="nav shell">
        <Link className="logo" href="/">
          <img {...imgProps(ART.logo, 'Qrie logo', true)} />
          <span>qrie ai</span>
        </Link>
        <Link className="back-home" href="/">← Back home</Link>
      </nav>
      <section className="register-shell shell">
        <div className="register-intro">
          <p className="eyebrow">Qrie Champion League</p>
          <h1>Ready to<br /><em>show up?</em></h1>
          <p>Tell us a little about the learner. We&apos;ll save your spot and take you straight to the challenge.</p>
          <div className="register-illustration">
            <img {...imgProps(ART.hand, 'Student learning on a mobile device', true)} />
          </div>
          <div className="register-highlight">
            <strong>₹1,00,000+</strong>
            <span>in prizes for curious minds</span>
          </div>
        </div>
        <form className="register-form" onSubmit={handleSubmit}>
          <div className="form-heading">
            <span>01</span>
            <div>
              <h2>Enter your details</h2>
              <p>All fields marked * are required.</p>
            </div>
          </div>
          <div className="form-grid">
            <label>Student name *<input name="studentName" required placeholder="Full name" /></label>
            <label>Parent / guardian name *<input name="parentName" required placeholder="Full name" /></label>
            <label>Student mobile number *<input name="studentMobile" type="tel" required pattern="[0-9]{10}" placeholder="10-digit number" /></label>
            <label>Parent / guardian mobile *<input name="parentMobile" type="tel" required pattern="[0-9]{10}" placeholder="10-digit number" /></label>
            {/*
              `name="klass"` and a plain value, not "10th". The label a child
              reads and the integer the database checks are different things,
              and the column is `klass integer check (klass between 6 and 12)`.
            */}
            <label>Class *
              <select name="klass" required defaultValue="">
                <option value="" disabled>Select class</option>
                <option value="6">6th</option>
                <option value="7">7th</option>
                <option value="8">8th</option>
                <option value="9">9th</option>
                <option value="10">10th</option>
                <option value="11">11th</option>
                <option value="12">12th</option>
              </select>
            </label>
            {/* Controlled, and now carrying a name — without one it was never
                part of the form data at all. */}
            <label>Do you take tuition elsewhere? *
              <select
                name="takesTuition"
                required
                value={takesTuition}
                onChange={(e) => setTakesTuition(e.target.value)}
              >
                <option value="" disabled>Select one</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="full-field">Student address *
              <textarea name="address" required placeholder="House / street, city, state, PIN code" rows={3} />
            </label>
          </div>
          <div className="consent-box">
            <label><input type="checkbox" required /> I confirm that the information shared is accurate and I am permitted to register this student.</label>
            <label><input type="checkbox" required /> I agree to Qrie&apos;s <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms &amp; Conditions</Link>.</label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          {state.at === 'failed' && <p className="form-error" role="alert">{state.message}</p>}
          {state.at === 'saved' ? (
            <div className="success-box">
              <strong>You&apos;re registered.</strong>
              <span>Your details are saved for this challenge.</span>
              <a className="pill dark-pill" href={APP_URL}>Continue to the test ↗</a>
            </div>
          ) : (
            <button className="pill dark-pill form-submit" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save & continue to test ↗'}
            </button>
          )}
        </form>
      </section>
    </main>
  )
}
