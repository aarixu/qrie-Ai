import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout';
import { Account } from '@/features/account';
import { Schools } from '@/features/schools';
import { SchoolPage } from '@/features/schools/school-page';
import { Switches } from '@/features/switches';
import { SCHOOL_TABS, type SchoolTab } from '@/features/schools/school-tabs';
import { StaffPage } from '@/features/staff';
import { System } from '@/features/system';
import { Today } from '@/features/today';
import { Users } from '@/features/users';

// Code-based routes: the console has a handful of pages, so there is no generated tree.
// Each later plan adds its pages here and to components/layout/data/sidebar-data.ts.
const root = createRootRoute({ component: () => <AuthenticatedLayout /> });
const today = createRoute({ getParentRoute: () => root, path: '/', component: Today });
const switches = createRoute({ getParentRoute: () => root, path: '/switches', component: Switches });

// Plan 2: schools, users, the system page, staff and audit, your account.
const schoolsList = createRoute({ getParentRoute: () => root, path: '/schools', component: Schools });
const schoolPage = createRoute({
  getParentRoute: () => root,
  path: '/schools/$code',
  validateSearch: (search: Record<string, unknown>): { tab: SchoolTab } => ({
    tab: SCHOOL_TABS.includes(search.tab as SchoolTab) ? (search.tab as SchoolTab) : 'overview',
  }),
  component: SchoolPage,
});
const usersPage = createRoute({ getParentRoute: () => root, path: '/users', component: Users });
const systemPage = createRoute({ getParentRoute: () => root, path: '/system', component: System });
const staffPage = createRoute({ getParentRoute: () => root, path: '/staff', component: StaffPage });
const accountPage = createRoute({ getParentRoute: () => root, path: '/account', component: Account });

export const router = createRouter({
  routeTree: root.addChildren([today, switches, schoolsList, schoolPage, usersPage, systemPage, staffPage, accountPage]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
