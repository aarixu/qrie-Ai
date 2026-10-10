import {
  Activity,
  BookOpen,
  FileText,
  IndianRupee,
  KeyRound,
  LayoutDashboard,
  Lock,
  Repeat,
  School,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Tags,
  ToggleRight,
  Users,
  Wallet,
  Webhook,
} from 'lucide-react';
import type { SidebarData } from '../types';

/**
 * The console's navigation. Only pages that exist are listed: a later plan adds
 * its group here when its pages land (Money; see the design's roadmap). An
 * item's roles name the staff roles it is meant for; plan 4 filters the
 * sidebar by them, and nothing on this branch does yet.
 */
export const sidebarData: SidebarData = {
  navGroups: [
    { title: 'Overview', items: [{ title: 'Today', url: '/', icon: LayoutDashboard }] },
    {
      title: 'Schools and people',
      items: [
        { title: 'Schools', url: '/schools', icon: School },
        { title: 'Users', url: '/users', icon: Users },
      ],
    },
    { title: 'Control', items: [{ title: 'Switches', url: '/switches', icon: ToggleRight }] },
    {
      title: 'Platform',
      items: [
        { title: 'System', url: '/system', icon: Activity },
        { title: 'Staff and audit', url: '/staff', icon: ShieldCheck },
        { title: 'Your account', url: '/account', icon: KeyRound },
      ],
    },
    {
      title: 'Safety and privacy',
      items: [
        { title: 'Safety', url: '/safety', icon: ShieldAlert, roles: ['owner', 'safety'] },
        { title: 'Classes', url: '/classes', icon: BookOpen, roles: ['owner', 'ops', 'safety'] },
        { title: 'Privacy', url: '/privacy', icon: Lock, roles: ['owner', 'ops'] },
      ],
    },
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
