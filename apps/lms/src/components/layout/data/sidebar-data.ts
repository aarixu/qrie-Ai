import { Library, LayoutDashboard, Palette } from 'lucide-react'
import { type SidebarData } from '../types'

/**
 * The teacher app's navigation. Only routes that exist are listed, so no
 * link leads nowhere. A teacher's classes are reached from the dashboard.
 */
export const sidebarData: SidebarData = {
  navGroups: [
    {
      title: 'Teaching',
      items: [
        {
          title: 'My classes',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: 'Question bank',
          url: '/bank',
          icon: Library,
        },
      ],
    },
    {
      title: 'Settings',
      items: [
        {
          title: 'Appearance',
          url: '/settings/appearance',
          icon: Palette,
        },
      ],
    },
  ],
}
