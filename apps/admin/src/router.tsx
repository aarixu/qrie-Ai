import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout';
import { Switches } from '@/features/switches';
import { Today } from '@/features/today';

// Code-based routes: the console has a handful of pages, so there is no generated tree.
// Each later plan adds its pages here and to components/layout/data/sidebar-data.ts.
const root = createRootRoute({ component: () => <AuthenticatedLayout /> });
const today = createRoute({ getParentRoute: () => root, path: '/', component: Today });
const switches = createRoute({ getParentRoute: () => root, path: '/switches', component: Switches });

export const router = createRouter({ routeTree: root.addChildren([today, switches]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
