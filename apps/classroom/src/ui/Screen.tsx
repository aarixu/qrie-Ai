import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { BottomNav } from './BottomNav';

/**
 * The page frame every screen sits in: background, the centred content column,
 * a title bar, and the bottom nav. One place means a new screen cannot drift
 * from the design — it only supplies its content.
 */
export function Screen({
  title,
  subtitle,
  onBack,
  nav = true,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Omit for a top-level tab; supply for a screen you can back out of. */
  onBack?: () => void;
  /** Hide the bottom nav on immersive screens (the lesson player). */
  nav?: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const back = onBack ?? (() => navigate(-1));

  return (
    <div className={`bg-background text-on-background min-h-screen font-body-md ${nav ? 'pb-24 md:pb-8' : 'pb-8'}`}>
      <header className="w-full top-0 sticky bg-background z-40">
        <div className="flex items-center gap-2 px-margin-mobile py-4 max-w-[1120px] mx-auto">
          {onBack !== undefined && (
            <button
              onClick={back}
              aria-label="Back"
              className="w-10 h-10 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
            >
              <Icon name="arrow_back" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="font-headline-md text-headline-md text-on-surface truncate">{title}</h1>
            {subtitle && (
              <p className="font-label-md text-label-md text-on-surface-variant">{subtitle}</p>
            )}
          </div>
        </div>
      </header>

      <main className="px-margin-mobile max-w-[1120px] mx-auto pb-20">{children}</main>

      {nav && <BottomNav />}
    </div>
  );
}

/** The standard empty/idle state — one icon, one line, optional action. */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center py-16 gap-3">
      <div className="w-16 h-16 rounded-full bg-surface-container grid place-items-center">
        <Icon name={icon} className="text-3xl text-on-surface-variant" />
      </div>
      <h2 className="font-headline-md text-[20px] leading-7 text-on-surface">{title}</h2>
      {body && <p className="font-body-md text-body-md text-on-surface-variant max-w-[46ch]">{body}</p>}
      {action}
    </div>
  );
}
