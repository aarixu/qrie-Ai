import { Suspense, lazy, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HELPLINES } from '@ai-tutor/safety';
import { CLASSROOM_BUILD, isBelowMinimum, useAppConfig } from '../lib/appConfig';

// Loaded only when a child taps Report on the pause card, as the replay in
// App.tsx loads it: the sheet stays out of the app's first chunk.
const ReportSheet = lazy(() => import('./ReportSheet').then((m) => ({ default: m.ReportSheet })));

/**
 * WHAT QRIE CONTROL SAYS, IN FRONT OF THE APP.
 *
 *   - An older build than app.min_version.classroom: a full-screen card asking
 *     to update, and nothing else but the helplines.
 *   - Otherwise the banner, when there is one, as plain text above the app.
 *   - tutor.enabled false for this learner: a full-screen pause card, with the
 *     helplines, instead of the learning screens. The database refuses the
 *     class anyway (claim_relay, migration 0064); this says so in words a
 *     child can read. The child's own account and Help stay open (Settings,
 *     with sign out and delete the account; Profile; Sign in; Help), and the
 *     card itself offers Report something, Settings and Help: a pause can last
 *     weeks, and it is when a child may have something to report.
 *
 * Both cards carry the helplines a child in distress can ring (R25). It reads
 * the location, so it sits inside the Router (App.tsx).
 */

/** The screens a child can still open while the tutor is switched off. */
const OPEN_WHILE_PAUSED = new Set(['/settings', '/profile', '/signin', '/help']);

function Helplines() {
  return (
    <div className="mt-6 text-left w-full">
      <p className="font-body-md text-body-md text-on-surface-variant mb-2">If you need to talk to someone now:</p>
      <ul className="grid gap-2">
        <li>
          <a
            href={`tel:${HELPLINES.telemanas}`}
            className="block bg-surface-container-lowest rounded-xl px-4 py-3 font-body-md text-body-md text-on-surface"
          >
            Tele-MANAS {HELPLINES.telemanas}
          </a>
        </li>
        <li>
          <a
            href={`tel:${HELPLINES.childline}`}
            className="block bg-surface-container-lowest rounded-xl px-4 py-3 font-body-md text-body-md text-on-surface"
          >
            Childline {HELPLINES.childline}
          </a>
        </li>
      </ul>
    </div>
  );
}

function Card({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="bg-background text-on-background min-h-screen grid place-items-center px-6 py-12">
      <div className="max-w-[420px] w-full flex flex-col items-center text-center gap-3">
        <h1 className="font-headline-md text-[22px] leading-8 text-on-surface">{title}</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">{body}</p>
        {children}
        <Helplines />
      </div>
    </div>
  );
}

/**
 * The banner's colours. The tutor's theme has no amber token, so a warning
 * uses the secondary container and information the plain surface.
 */
const TONE = {
  warning: 'bg-secondary-container text-on-secondary-container',
  info: 'bg-surface-container text-on-surface',
} as const;

const ACTION =
  'block w-full bg-surface-container-lowest rounded-xl px-4 py-3 font-label-md text-label-md text-on-surface text-center';

export function AppConfigGate({ children }: { children: ReactNode }) {
  const c = useAppConfig();
  const { pathname } = useLocation();
  const [reporting, setReporting] = useState(false);

  if (isBelowMinimum(CLASSROOM_BUILD, c.minVersion)) {
    return (
      <Card title="Time to update Qrie" body="This version of the app is too old to use. Please update it, then open it again.">
        <button
          onClick={() => window.location.reload()}
          className="bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl mt-1"
        >
          Reload
        </button>
      </Card>
    );
  }

  const banner =
    c.bannerMessage !== '' ? (
      <div role="status" data-tone={c.bannerTone} className={`px-4 py-2 text-center font-body-md text-body-md ${TONE[c.bannerTone]}`}>
        {c.bannerMessage}
      </div>
    ) : null;

  const open = c.tutorEnabled || OPEN_WHILE_PAUSED.has(pathname.replace(/\/+$/, '') || '/');

  return (
    <>
      {banner}
      {open ? (
        children
      ) : (
        <Card
          title="The tutor is switched off for now"
          body="Classes are paused at the moment. Please come back later; nothing you have done is lost."
        >
          <div className="grid gap-2 w-full mt-2">
            <button onClick={() => setReporting(true)} className={ACTION}>
              Report something
            </button>
            <Link to="/settings" className={ACTION}>
              Settings: sign out or delete your account
            </Link>
            <Link to="/help" className={ACTION}>
              Help
            </Link>
          </div>
        </Card>
      )}
      {reporting && (
        <Suspense fallback={null}>
          <ReportSheet place="app" onClose={() => setReporting(false)} />
        </Suspense>
      )}
    </>
  );
}
