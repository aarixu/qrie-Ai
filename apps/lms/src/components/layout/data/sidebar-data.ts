import { LayoutDashboard, Monitor, Palette, School, Settings, UserCog } from 'lucide-react'
import { type SidebarData } from '../types'

/**
 * The teacher app's navigation. It grows as the LMS screens land (LMS build
 * plan, L4); only routes that exist are listed, so no link leads nowhere.
 *
 * `user` and `teams` are placeholders until sign-in (ID + PIN) and the
 * school's own branding replace them.
 */
export const sidebarData: SidebarData = {
  user: {
    name: 'Teacher',
    email: '',
    avatar: '',
  },
  teams: [
    {
      name: 'Qrie LMS',
      logo: School,
      plan: 'Teacher',
    },
  ],
  navGroups: [
    {
      title: 'Teaching',
      items: [
        {
          title: 'Dashboard',
          url: '/',
          icon: LayoutDashboard,
        },
      ],
    },
    {
      title: 'Other',
      items: [
        {
          title: 'Settings',
          icon: Settings,
          items: [
            {
              title: 'Profile',
              url: '/settings',
              icon: UserCog,
            },
            {
              title: 'Appearance',
              url: '/settings/appearance',
              icon: Palette,
            },
            {
              title: 'Display',
              url: '/settings/display',
              icon: Monitor,
            },
          ],
        },
      ],
    },
  ],
}
