import { type LinkProps } from '@tanstack/react-router'
import type { Me } from '@ai-tutor/admin-client'

type BaseNavItem = {
  title: string
  badge?: string
  icon?: React.ElementType
  /** Which staff roles see this item; absent means every role. Plan 4 filters the sidebar by it. */
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
