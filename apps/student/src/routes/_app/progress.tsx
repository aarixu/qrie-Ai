import { createFileRoute } from '@tanstack/react-router'
import { ProgressPage } from '@/features/progress'

export const Route = createFileRoute('/_app/progress')({
  component: ProgressPage,
})
