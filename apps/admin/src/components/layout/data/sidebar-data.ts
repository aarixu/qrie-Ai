import {
  Activity,
  BookOpen,
  FileText,
  IndianRupee,
  KeyRound,
  LayoutDashboard,
  MonitorSmartphone,
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
import type { Me } from '@ai-tutor/admin-client';
import type { SidebarData } from '../types';

/** Today, Schools, Switches, Apps, System: today, school_list, flag_list, system_health, relay_status (owner, ops, safety). */
const CONTROL: Me['role'][] = ['owner', 'ops', 'safety'];
/** Every billing_* read (owner, ops, finance). */
const MONEY: Me['role'][] = ['owner', 'ops', 'finance'];

/**
 * The console's navigation. Only pages that exist are listed: a later plan adds
 * its group here when its pages land (Money; see the design's roadmap). Each
 * item names the staff roles whose database reads let them use the page (the
 * database refuses the rest anyway); lib/nav.ts filters by the signed-in role.
 */
export const sidebarData: SidebarData = {
  navGroups: [
    { title: 'Overview', items: [{ title: 'Today', url: '/', icon: LayoutDashboard, roles: CONTROL }] },
    {
      title: 'Schools and people',
      items: [
        { title: 'Schools', url: '/schools', icon: School, roles: CONTROL },
        // direct_users_summary: ops.
        { title: 'Users', url: '/users', icon: Users, roles: ['owner', 'ops'] },
      ],
    },
    {
      title: 'Control',
      items: [
        { title: 'Switches', url: '/switches', icon: ToggleRight, roles: CONTROL },
        { title: 'Apps', url: '/apps', icon: MonitorSmartphone, roles: CONTROL },
      ],
    },
    {
      title: 'Platform',
      items: [
        { title: 'System', url: '/system', icon: Activity, roles: CONTROL },
        // staff_roster, audit_list: the owner only.
        { title: 'Staff and audit', url: '/staff', icon: ShieldCheck, roles: ['owner'] },
        // me: every role.
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
        { title: 'Billing', url: '/billing', icon: Wallet, roles: MONEY },
        { title: 'Invoices', url: '/billing/invoices', icon: FileText, roles: MONEY },
        { title: 'Subscriptions', url: '/billing/subscriptions', icon: Repeat, roles: MONEY },
        { title: 'Payments', url: '/billing/payments', icon: IndianRupee, roles: MONEY },
        { title: 'Schools', url: '/billing/schools', icon: School, roles: MONEY },
        { title: 'Webhook log', url: '/billing/webhooks', icon: Webhook, roles: MONEY },
        { title: 'Plans', url: '/billing/plans', icon: Tags, roles: MONEY },
        { title: 'Settings', url: '/billing/settings', icon: Settings, roles: MONEY },
      ],
    },
  ],
};
