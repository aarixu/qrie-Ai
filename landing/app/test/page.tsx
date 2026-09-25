import { redirect } from 'next/navigation'
import { APP_URL } from '@/lib/app-url'

/**
 * THE HANDOFF, WHICH USED TO BE A PLACEHOLDER ADMITTING IT WAS ONE.
 *
 * This page said "This is the test handoff page. Connect your test platform
 * here when you are ready." and it was the destination of the button a parent
 * pressed straight after registering — so the funnel dead-ended one click
 * after the form, in writing.
 *
 * The test platform is the webapp, and it is connected now. This stays as a
 * redirect rather than being deleted because the URL is already out there: the
 * old register page linked to it, and anything that bookmarked or shared it
 * should land on the class rather than a 404.
 *
 * A redirect and not a page with a button: there is nothing for a student to
 * read here, and a second click between registering and learning is a second
 * chance to close the tab.
 */
export default function TestPage() {
  redirect(APP_URL)
}
