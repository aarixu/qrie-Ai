import type { Me } from '@ai-tutor/admin-client';
import type { NavGroup, NavItem, SidebarData } from '@/components/layout/types';

/**
 * The sidebar and the Ctrl+K menu for one staff role: an item is kept when it
 * names no roles, names this one, or the role is the owner's (admin.require_staff
 * lets the owner through everywhere). A group left with no items is dropped.
 * The database refuses a page's read to anyone else whatever is shown.
 */
export function navFor(role: Me['role'], data: SidebarData): NavGroup[] {
  const sees = (roles?: Me['role'][]) => role === 'owner' || !roles || roles.includes(role);
  return data.navGroups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((i) => sees(i.roles))
        .map((i) => (i.items ? { ...i, items: i.items.filter((s) => sees(s.roles)) } : i)) as NavItem[],
    }))
    .filter((g) => g.items.length > 0);
}

/** Where a role lands: admin.today refuses finance, so finance starts on Billing. */
export const homeFor = (role: Me['role']): '/' | '/billing' => (role === 'finance' ? '/billing' : '/');

/** Today and System carry the stop for the roles that can open them; finance (0061) can open neither. */
export const showsHeaderStop = (role: Me['role']): boolean => role === 'finance';
