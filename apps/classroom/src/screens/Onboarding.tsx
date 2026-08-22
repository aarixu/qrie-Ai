import { useNavigate } from 'react-router-dom';
import { settingsStore } from '../stores/settings';
import { Icon } from '../ui/Icon';

const CLASSES = [6, 7, 8, 9, 10, 11, 12];

/**
 * First run: pick your class. One question, seven big targets, straight into
 * the app. The choice personalises Home and later feeds the lesson designer's
 * language level.
 *
 * (The fuller flow — name, subjects, then the diagnostic — lands with the
 * Learning Outcome Map.)
 */
export function Onboarding() {
  const navigate = useNavigate();

  const pick = (klass: number) => {
    settingsStore.update((s) => ({ ...s, klass }));
    navigate('/', { replace: true });
  };

  return (
    <div className="bg-background text-on-background min-h-screen font-body-md grid place-items-center px-margin-mobile py-10">
      <div className="w-full max-w-[440px] text-center">
        <div className="w-16 h-16 rounded-full bg-primary-fixed text-on-primary-fixed grid place-items-center mx-auto mb-5">
          <Icon name="school" filled className="text-3xl" />
        </div>

        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
          Which class are you in?
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant mb-stack-md">
          Your classes will match your level. You can change this anytime.
        </p>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {CLASSES.map((k) => (
            <button
              key={k}
              onClick={() => pick(k)}
              className="bg-surface-container-lowest rounded-[20px] py-5 shadow-sm hover:shadow-md hover:scale-[1.03] border-2 border-transparent hover:border-primary-fixed-dim transition-all flex flex-col items-center"
            >
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">
                Class
              </span>
              <span className="font-headline-lg text-[30px] leading-9 text-primary">{k}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
