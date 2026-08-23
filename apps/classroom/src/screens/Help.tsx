import { useNavigate } from 'react-router-dom';
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
    a: `On this device, in this browser. There are no accounts yet, so clearing your browser data — or opening ${BRAND.name} on a different phone — starts you with an empty progress screen.`,
  },
];

export function Help() {
  const navigate = useNavigate();

  return (
    <Screen title="Help" subtitle="How the class works" onBack={() => navigate('/settings')}>
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
