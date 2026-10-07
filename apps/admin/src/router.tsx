import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout';
import { Switches } from '@/features/switches';
import { SCHOOL_TABS, type SchoolTab } from '@/features/schools/school-tabs';
import { Today } from '@/features/today';

// Code-based routes: the console has a handful of pages, so there is no generated tree.
// Each later plan adds its pages here and to components/layout/data/sidebar-data.ts.
const root = createRootRoute({ component: () => <AuthenticatedLayout /> });
const today = createRoute({ getParentRoute: () => root, path: '/', component: Today });
const switches = createRoute({ getParentRoute: () => root, path: '/switches', component: Switches });

// Plan 2: schools, users, the system page, staff and audit, your account.
const schoolsList = createRoute({ getParentRoute: () => root, path: '/schools', component: () => null });
const schoolPage = createRoute({
  getParentRoute: () => root,
  path: '/schools/$code',
  validateSearch: (search: Record<string, unknown>): { tab: SchoolTab } => ({
    tab: SCHOOL_TABS.includes(search.tab as SchoolTab) ? (search.tab as SchoolTab) : 'overview',
  }),
  component: () => null,
});
const usersPage = createRoute({ getParentRoute: () => root, path: '/users', component: () => null });
const systemPage = createRoute({ getParentRoute: () => root, path: '/system', component: () => null });
const staffPage = createRoute({ getParentRoute: () => root, path: '/staff', component: () => null });
const accountPage = createRoute({ getParentRoute: () => root, path: '/account', component: () => null });

export const router = createRouter({
  routeTree: root.addChildren([today, switches, schoolsList, schoolPage, usersPage, systemPage, staffPage, accountPage]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
