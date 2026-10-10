import { createFileRoute } from '@tanstack/react-router'
import { Privacy } from '@/features/privacy'

// Outside _app: read before signing in as well as after.
export const Route = createFileRoute('/privacy')({
  component: Privacy,
})
