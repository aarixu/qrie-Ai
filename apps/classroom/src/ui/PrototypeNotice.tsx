import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { PROTOTYPE_NOTICE } from '../lib/prototype';

/**
 * WHAT A STUDENT SEES WHEN THEY REACH FOR A CLASS THAT IS NOT MADE YET.
 *
 * The same dialog shell as MicRationale, deliberately: this app has exactly
 * one modal idiom and a second one would be a second thing to keep accessible.
 * `role="dialog"` + `aria-modal` + an aria-label, bottom sheet on a phone and
 * centred on a wider screen.
 *
 * IT DOES NOT LEAVE THEM WHERE THEY ARE. A notice that only says no is a dead
 * end on the screen where they were trying to do something, so the main button
 * takes them to the syllabus, where the topics that ARE ready are the ones
 * still tappable. "Close" is a real second answer for a student who was just
 * browsing and does not want to be moved.
 *
 * The tone is the one RefusalNotice set: say the true thing in a child's
 * words, once, and do not apologise twice.
 */
export function PrototypeNotice({
  /** The title of the topic they tapped, so the notice names it. */
  topic,
  onClose,
}: {
  topic: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={PROTOTYPE_NOTICE.title}
      className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-black/50 px-4 pb-4 sm:pb-0"
      // A tap on the dark surround closes it. The inner card stops the event so
      // a tap on the card itself does not.
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-surface-container-lowest rounded-[24px] p-card-padding shadow-lg font-body-md flex flex-col gap-4"
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 rounded-full bg-primary-fixed grid place-items-center">
            <Icon name="schedule" filled className="text-3xl text-on-primary-fixed" />
          </div>
          <h2 className="font-headline-md text-[20px] leading-7 text-on-surface">
            {PROTOTYPE_NOTICE.title}
          </h2>
          {/* Naming the topic is the difference between "something went wrong"
              and an answer: they tapped Real Numbers, so the notice says so. */}
          <p className="font-body-md text-body-md text-on-surface-variant">
            <b className="text-on-surface">{topic}</b> is in the syllabus, but the class has not
            been made yet.
          </p>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {PROTOTYPE_NOTICE.body}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => {
              onClose();
              navigate('/syllabus');
            }}
            className="w-full bg-primary text-on-primary font-label-md text-label-md py-3 rounded-xl border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
          >
            {PROTOTYPE_NOTICE.cta}
          </button>
          <button
            onClick={onClose}
            className="w-full text-on-surface-variant font-label-md text-label-md py-3 rounded-xl hover:bg-surface-container-high transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
