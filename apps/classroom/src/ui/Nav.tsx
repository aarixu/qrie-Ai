import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { BRAND } from '../brand';

/**
 * The app's primary navigation, in the two shapes a learning app needs.
 *
 * Mobile gets the bottom bar; desktop gets a left rail. They are one list of
 * destinations rendered twice rather than two components, because a tab that
 * exists on one and not the other is exactly the drift this file prevents —
 * the bottom bar was previously `md:hidden` with nothing behind it, which left
 * a desktop student with no way out of a screen but the browser's back button.
 */

const TABS = [
  { to: '/', icon: 'home', label: 'Home' },
  { to: '/syllabus', icon: 'menu_book', label: 'Syllabus' },
  { to: '/search', icon: 'search', label: 'Search' },
  { to: '/progress', icon: 'insights', label: 'Progress' },
  { to: '/profile', icon: 'person', label: 'Profile' },
] as const;

export function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 left-0 w-full flex justify-around items-center px-4 py-3 bg-surface-container-lowest z-50 rounded-t-xl shadow-[0px_-4px_20px_rgba(99,102,241,0.08)] md:hidden"
    >
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

/** The desktop rail. Hidden below md, where the bottom bar takes over. */
export function SideNav() {
  return (
    <nav
      aria-label="Main"
      className="hidden md:flex fixed left-0 top-0 h-full w-[232px] flex-col gap-1 border-r-2 border-surface-variant bg-surface-container-lowest px-4 py-6 z-40"
    >
      <NavLink to="/" className="flex items-center gap-3 px-3 pb-6">
        <Logo size={32} />
        <span className="font-headline-md text-[20px] leading-7 text-primary">{BRAND.name}</span>
      </NavLink>

      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            [
              'flex items-center gap-3 rounded-xl px-4 py-3 font-label-md text-label-md transition-colors',
              isActive
                ? 'bg-primary-container text-on-primary-container font-bold'
                : 'text-on-surface-variant hover:bg-surface-container-high',
            ].join(' ')
          }
        >
          {({ isActive }) => (
            <>
              <Icon name={tab.icon} filled={isActive} />
              {tab.label}
            </>
          )}
        </NavLink>
      ))}

      <div className="mt-auto px-4">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            [
              'flex items-center gap-3 rounded-xl px-0 py-3 font-label-md text-label-md transition-colors',
              isActive ? 'text-primary font-bold' : 'text-on-surface-variant hover:text-on-surface',
            ].join(' ')
          }
        >
          <Icon name="settings" />
          Settings
        </NavLink>
      </div>
    </nav>
  );
}
