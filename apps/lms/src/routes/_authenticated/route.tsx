import { createFileRoute, redirect } from '@tanstack/react-router'
import { loadMe } from '@/stores/auth-store'
import { AuthenticatedLayout } from '@/components/layout/authenticated-layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const me = await loadMe()
    if (!me) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return { me }
  },
  component: AuthenticatedLayout,
})
