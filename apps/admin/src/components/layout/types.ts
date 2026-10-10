import { type LinkProps } from '@tanstack/react-router'
import type { Me } from '@ai-tutor/admin-client'

type BaseNavItem = {
  title: string
  badge?: string
  icon?: React.ElementType
  /** Staff roles that see this item; absent = every staff role. The owner sees every item (as admin.require_staff lets the owner through). */
  roles?: Me['role'][]
}

type NavLink = BaseNavItem & {
  url: LinkProps['to'] | (string & {})
  items?: never
}

type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & { url: LinkProps['to'] | (string & {}) })[]
  url?: never
}

type NavItem = NavCollapsible | NavLink

type NavGroup = {
  title: string
  items: NavItem[]
}

type SidebarData = {
  navGroups: NavGroup[]
}

export type { SidebarData, NavGroup, NavItem, NavCollapsible, NavLink }
