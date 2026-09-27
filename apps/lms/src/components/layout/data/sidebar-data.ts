import {
  BookOpenCheck,
  GraduationCap,
  LayoutDashboard,
  Library,
  Palette,
  PieChart,
  School,
  UserPlus,
  Users,
} from 'lucide-react'
import type { AccountKind } from '@ai-tutor/lms-client'
import { type NavGroup, type SidebarData } from '../types'

const settings: NavGroup = {
  title: 'Settings',
  items: [{ title: 'Appearance', url: '/settings/appearance', icon: Palette }],
}

/**
 * The navigation for who is signed in. Only routes that exist are listed, so
 * no link leads nowhere. A teacher's classes are reached from their home; the
 * school's admin gets the School portal, which is their home.
 */
export function sidebarFor(kind: AccountKind | undefined): SidebarData {
  if (kind === 'admin') {
    return {
      navGroups: [
        {
          title: 'School',
          items: [
            { title: 'Overview', url: '/school', icon: PieChart },
            { title: 'Classes', url: '/school/classes', icon: School },
            { title: 'Students', url: '/school/students', icon: GraduationCap },
            { title: 'Teachers', url: '/school/teachers', icon: Users },
            { title: 'Add people', url: '/school/people', icon: UserPlus },
            { title: 'School settings', url: '/school/settings', icon: BookOpenCheck },
          ],
        },
        {
          title: 'Content',
          items: [{ title: 'Question bank', url: '/bank', icon: Library }],
        },
        settings,
      ],
    }
  }
  return {
    navGroups: [
      {
        title: 'Teaching',
        items: [
          { title: 'Home', url: '/', icon: LayoutDashboard },
          { title: 'Question bank', url: '/bank', icon: Library },
        ],
      },
      settings,
    ],
  }
}
