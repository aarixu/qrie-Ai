import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout';
import { Account } from '@/features/account';
import { AppsPage } from '@/features/apps';
import { BillingOverviewPage } from '@/features/billing';
import { InvoiceDetailPage } from '@/features/billing/invoice-detail';
import { InvoicePrint } from '@/features/billing/invoice-print';
import { InvoicesPage } from '@/features/billing/invoices';
import { PaymentsPage } from '@/features/billing/payments';
import { PlansPage } from '@/features/billing/plans';
import { SchoolBillingPage } from '@/features/billing/school-page';
import { BillingSchoolsPage } from '@/features/billing/schools';
import { SettingsPage } from '@/features/billing/settings';
import { SubscriptionsPage } from '@/features/billing/subscriptions';
import { WebhooksPage } from '@/features/billing/webhooks';
import { chartSearch } from '@/features/charts/model';
import { ChartsMoney } from '@/features/charts/money';
import { ChartsOverview } from '@/features/charts/overview';
import { ChartsSafety } from '@/features/charts/safety';
import { Classes } from '@/features/classes';
import { ClassPage } from '@/features/classes/class-page';
import { Privacy } from '@/features/privacy';
import { RequestPage } from '@/features/privacy/request-page';
import { Safety } from '@/features/safety';
import { CasePage } from '@/features/safety/case-page';
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
const appsPage = createRoute({ getParentRoute: () => root, path: '/apps', component: AppsPage });

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

// Billing (plan 3).
const billingOverview = createRoute({ getParentRoute: () => root, path: '/billing', component: BillingOverviewPage });
const billingInvoices = createRoute({ getParentRoute: () => root, path: '/billing/invoices', component: InvoicesPage });
const billingInvoice = createRoute({ getParentRoute: () => root, path: '/billing/invoices/$invoiceId', component: InvoiceDetailPage });
const billingInvoicePrint = createRoute({ getParentRoute: () => root, path: '/billing/invoices/$invoiceId/print', component: InvoicePrint });
const billingSubscriptions = createRoute({ getParentRoute: () => root, path: '/billing/subscriptions', component: SubscriptionsPage });
const billingPayments = createRoute({ getParentRoute: () => root, path: '/billing/payments', component: PaymentsPage });
const billingSchools = createRoute({ getParentRoute: () => root, path: '/billing/schools', component: BillingSchoolsPage });
const billingSchool = createRoute({ getParentRoute: () => root, path: '/billing/schools/$orgId', component: SchoolBillingPage });
const billingWebhooks = createRoute({ getParentRoute: () => root, path: '/billing/webhooks', component: WebhooksPage });
const billingPlans = createRoute({ getParentRoute: () => root, path: '/billing/plans', component: PlansPage });
const billingSettings = createRoute({ getParentRoute: () => root, path: '/billing/settings', component: SettingsPage });

// Safety, classes and privacy (plan 5).
const safetyPage = createRoute({ getParentRoute: () => root, path: '/safety', component: Safety });
const casePage = createRoute({ getParentRoute: () => root, path: '/safety/cases/$caseId', component: CasePage });
const classesPage = createRoute({ getParentRoute: () => root, path: '/classes', component: Classes });
const classPage = createRoute({ getParentRoute: () => root, path: '/classes/$classId', component: ClassPage });
const privacyPage = createRoute({ getParentRoute: () => root, path: '/privacy', component: Privacy });
const requestPage = createRoute({ getParentRoute: () => root, path: '/privacy/requests/$requestId', component: RequestPage });

// The chart pages (plan 6): ?days=7|30, and on Schools and Learning ?school=<code>.
const chartRoute = <P extends string>(path: P, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => root, path, validateSearch: chartSearch, component });
const chartsOverview = chartRoute('/charts/overview', ChartsOverview);
const chartsMoney = chartRoute('/charts/money', ChartsMoney);
const chartsSafety = chartRoute('/charts/safety', ChartsSafety);

export const router = createRouter({
  routeTree: root.addChildren([
    today,
    switches,
    appsPage,
    schoolsList,
    schoolPage,
    usersPage,
    systemPage,
    staffPage,
    accountPage,
    billingOverview,
    billingInvoices,
    billingInvoice,
    billingInvoicePrint,
    billingSubscriptions,
    billingPayments,
    billingSchools,
    billingSchool,
    billingWebhooks,
    billingPlans,
    billingSettings,
    safetyPage,
    casePage,
    classesPage,
    classPage,
    privacyPage,
    requestPage,
    chartsOverview,
    chartsMoney,
    chartsSafety,
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
