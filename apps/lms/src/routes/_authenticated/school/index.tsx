import { createFileRoute } from '@tanstack/react-router'
import { SchoolOverviewPage } from '@/features/school/overview'

export const Route = createFileRoute('/_authenticated/school/')({
  component: SchoolOverviewPage,
})
