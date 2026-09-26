import { School } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

/**
 * The school this teacher belongs to. (The template's team switcher; a
 * teacher belongs to one school, so there is nothing to switch.)
 */
export function TeamSwitcher() {
  const me = useAuthStore((s) => s.me)
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size='lg' className='cursor-default'>
          <div className='flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground'>
            <School className='size-4' />
          </div>
          <div className='grid flex-1 text-start text-sm leading-tight'>
            <span className='truncate font-semibold'>
              {me?.schoolName ?? 'Qrie'}
            </span>
            <span className='truncate text-xs'>
              {me ? `${me.board} · ${me.kind === 'admin' ? 'Admin' : 'Teacher'}` : 'Teacher'}
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
