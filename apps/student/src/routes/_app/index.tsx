import { createFileRoute } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { Home } from '@/features/home'
import { ParentHome } from '@/features/parent'

export const Route = createFileRoute('/_app/')({
  component: function HomeRoute() {
    const kind = useAuthStore((s) => s.me?.kind)
    return kind === 'parent' ? <ParentHome /> : <Home />
  },
})
