import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout';
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
import { Switches } from '@/features/switches';
import { Today } from '@/features/today';

// Code-based routes: the console has a handful of pages, so there is no generated tree.
// Each later plan adds its pages here and to components/layout/data/sidebar-data.ts.
const root = createRootRoute({ component: () => <AuthenticatedLayout /> });
const today = createRoute({ getParentRoute: () => root, path: '/', component: Today });
const switches = createRoute({ getParentRoute: () => root, path: '/switches', component: Switches });

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

export const router = createRouter({
  routeTree: root.addChildren([
    today,
    switches,
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
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
