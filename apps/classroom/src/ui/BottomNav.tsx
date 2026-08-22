import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';

const TABS = [
  { to: '/', icon: 'home', label: 'Home' },
  { to: '/search', icon: 'search', label: 'Search' },
  { to: '/progress', icon: 'insights', label: 'Progress' },
  { to: '/profile', icon: 'person', label: 'Profile' },
] as const;

/**
 * The app's primary navigation. Mobile only — on desktop the content column is
 * narrow enough that the header carries navigation instead, which is how the
 * Stitch design handles it (md:hidden).
 */
export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 py-3 bg-surface-container-lowest z-50 rounded-t-xl shadow-[0px_-4px_20px_rgba(99,102,241,0.08)] md:hidden">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            [
              'flex flex-col items-center justify-center rounded-full px-4 py-1 transition-all duration-300 ease-out',
              isActive
                ? 'bg-primary-container text-on-primary-container scale-105'
                : 'text-on-surface-variant hover:bg-surface-container-high',
            ].join(' ')
          }
        >
          {({ isActive }) => (
            <>
              <Icon name={tab.icon} filled={isActive} className="mb-1" />
              <span className="font-label-sm text-label-sm">{tab.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
