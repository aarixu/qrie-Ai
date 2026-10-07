import { createFileRoute } from '@tanstack/react-router'
import { Work } from '@/features/work'

export const Route = createFileRoute('/_app/work')({
  component: Work,
})
