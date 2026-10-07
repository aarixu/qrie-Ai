import { FileText, IndianRupee, LayoutDashboard, Repeat, School, Settings, Tags, ToggleRight, Wallet, Webhook } from 'lucide-react';
import type { SidebarData } from '../types';

/**
 * The console's navigation. Only pages that exist are listed: a later plan adds
 * its group here when its pages land (Schools, Users, Billing, Safety, Classes,
 * Privacy, Money, Staff and audit; see the design's roadmap).
 */
export const sidebarData: SidebarData = {
  navGroups: [
    { title: 'Overview', items: [{ title: 'Today', url: '/', icon: LayoutDashboard }] },
    { title: 'Control', items: [{ title: 'Switches', url: '/switches', icon: ToggleRight }] },
    {
      title: 'Billing',
      items: [
        { title: 'Billing', url: '/billing', icon: Wallet },
        { title: 'Invoices', url: '/billing/invoices', icon: FileText },
        { title: 'Subscriptions', url: '/billing/subscriptions', icon: Repeat },
        { title: 'Payments', url: '/billing/payments', icon: IndianRupee },
        { title: 'Schools', url: '/billing/schools', icon: School },
        { title: 'Webhook log', url: '/billing/webhooks', icon: Webhook },
        { title: 'Plans', url: '/billing/plans', icon: Tags },
        { title: 'Settings', url: '/billing/settings', icon: Settings },
      ],
    },
  ],
};
