import { useNavigate } from 'react-router-dom';
import { HELPLINES } from '@ai-tutor/safety';
import { BRAND } from '../brand';
import { Screen } from '../ui/Screen';
import { Icon } from '../ui/Icon';

/**
 * The questions students actually ask, answered in the app rather than in a
 * support inbox we do not have. Every answer describes what the code really
 * does today — a help page that promises a feature is a bug report waiting to
 * be filed.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: 'What is the placement test for?',
    a: `It finds the last thing you are solid on, so your lessons can start there instead of at page one. ${BRAND.name} turns your answers into a study plan: what is worth fixing first, and what you can skip because you already know it. There are no marks, and nothing to revise beforehand.`,
  },
  {
    q: 'Why does it not tell me if I got a question right?',
    a: 'Because it is not a test you can pass or fail. The moment a question shows you the answer, the next one stops measuring what you knew and starts measuring what you just picked up — and a plan built on that would send you to the wrong lessons. "I am not sure" is a real answer here, and often the most useful one you can give.',
  },
  {
    q: 'What happens when I raise my hand?',
    a: 'The class pauses at that exact moment and a live tutor takes over, already knowing which part of the lesson you were on. Ask your doubt in your own words. When it is sorted, the class carries on from the same spot — you never lose your place, and nothing is skipped.',
  },
  {
    q: 'How does the streak work?',
    a: 'It counts the days in a row you finished at least one lesson. Two lessons in one day still count as one day, and re-watching something you have already finished does not add to it. If you finished a lesson yesterday and none yet today, your streak is still alive — today is not over.',
  },
  {
    q: 'How do I change my class?',
    a: 'Settings, then Class under Learning. Your subjects reset to the list for the new class, so glance at them before you leave the screen. Lessons you have already finished, and your streak, stay exactly as they were.',
  },
  {
    q: 'Where is my progress saved?',
    a: `On this device first, so it works with no signal. Sign in with your email and it also goes to your account, which is what lets you carry on from a different phone. Without signing in, clearing your browser data starts you with an empty progress screen.`,
  },
  {
    q: 'Can I tell you if she says something wrong?',
    a: 'Yes, and please do. There is a Report button in the class, next to Leave. Pick what happened, add anything you want to say, and it is saved on your phone so you can show a parent or a teacher. Nothing is sent anywhere without you pressing send.',
  },
  {
    q: 'What does she do with what I tell her?',
    a: `Your words go to the model that answers you, and nothing else. Phone numbers, addresses and email addresses are taken out before they are sent — so if you type one by accident, it does not travel. ${BRAND.name} keeps no recording of your voice and no copy of what you said.`,
  },
];

export function Help() {
  const navigate = useNavigate();

  return (
    <Screen title="Help" subtitle="How the class works" onBack={() => navigate('/settings')}>
      {/*
        FIRST ON THE PAGE, ABOVE "how it works".
        A student who opens Help because something is wrong should not have to
        read about streaks first. Free, Indian, and answered by people.
      */}
      <section className="ring-tint-blue rounded-[24px] p-card-padding mb-stack-md">
        <h2 className="font-headline-md text-[20px] leading-7 text-on-surface mb-stack-sm">
          If you need to talk to a person
        </h2>
        <p className="font-body-md text-body-md text-on-surface-variant mb-3">
          I am a tutor, and some things need a person. These are free, they answer in many
          languages, and you can ring them at any hour.
        </p>
        <ul className="grid gap-2">
          <li>
            <a
              href={`tel:${HELPLINES.telemanas}`}
              className="flex items-center gap-3 bg-surface-container-lowest rounded-xl px-4 py-3 font-body-md text-body-md text-on-surface"
            >
              <Icon name="forum" className="text-on-surface-variant" />
              <span className="flex-1">
                <strong>Tele-MANAS {HELPLINES.telemanas}</strong> — if you are struggling, low, or
                just want someone to listen
              </span>
            </a>
          </li>
          <li>
            <a
              href={`tel:${HELPLINES.childline}`}
              className="flex items-center gap-3 bg-surface-container-lowest rounded-xl px-4 py-3 font-body-md text-body-md text-on-surface"
            >
              <Icon name="front_hand" className="text-on-surface-variant" />
              <span className="flex-1">
                <strong>Childline {HELPLINES.childline}</strong> — if someone is hurting you or you
                do not feel safe
              </span>
            </a>
          </li>
        </ul>
      </section>

      <section className="bg-surface-container-lowest rounded-[24px] p-card-padding shadow-soft-indigo mb-stack-md">
        <h2 className="font-headline-md text-[20px] leading-7 text-on-surface mb-stack-sm">
          How it works
        </h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Every class here was taught live once, to real students, and recorded — so what you watch
          is a real lesson, not a slideshow being read out. When you get stuck, raise your hand and
          the recording pauses; a live tutor picks up from that exact moment, answers your doubt,
          then hands you back to the class where it stopped. That is the whole idea behind{' '}
          {BRAND.name}: the patience of a private tutor, at the speed of a recording you control.
        </p>
      </section>

      <h2 className="font-label-sm text-label-sm uppercase tracking-wider text-outline mb-stack-sm">
        Common questions
      </h2>
      <div className="flex flex-col gap-2 mb-stack-md">
        {FAQ.map(({ q, a }) => (
          // Native details/summary: keyboard support, screen-reader semantics
          // and the open state all come for free, and it works before hydration.
          <details
            key={q}
            className="group bg-surface-container-lowest rounded-[16px] shadow-soft-indigo"
          >
            <summary className="flex items-center gap-3 p-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden font-body-md text-body-md text-on-surface">
              <span className="flex-1">{q}</span>
              <Icon
                name="expand_more"
                className="text-outline-variant transition-transform group-open:rotate-180"
              />
            </summary>
            <p className="px-4 pb-4 font-body-md text-body-md text-on-surface-variant">{a}</p>
          </details>
        ))}
      </div>

      <button
        onClick={() => navigate('/settings')}
        className="w-full bg-surface-container-lowest rounded-[16px] p-4 flex items-center gap-4 shadow-soft-indigo text-left hover:scale-[1.01] transition-transform"
      >
        <Icon name="settings" className="text-primary" />
        <span className="flex-1 font-body-md text-body-md text-on-surface">
          Your class, your subjects and how lessons play all live in Settings.
        </span>
        <Icon name="chevron_right" className="text-outline-variant" />
      </button>
    </Screen>
  );
}
