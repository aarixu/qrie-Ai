import { LayoutDashboard, ToggleRight } from 'lucide-react';
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
  ],
};
