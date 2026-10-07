import { createFileRoute } from '@tanstack/react-router'
import { SchoolActivityPage } from '@/features/school/activity'

export const Route = createFileRoute('/_authenticated/school/activity')({
  component: SchoolActivityPage,
})
