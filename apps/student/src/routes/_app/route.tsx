import { createFileRoute, redirect } from '@tanstack/react-router'
import { loadMe } from '@/stores/auth-store'
import { Shell } from '@/components/shell'

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const me = await loadMe()
    if (!me) throw redirect({ to: '/sign-in' })
    return { me }
  },
  component: Shell,
})
