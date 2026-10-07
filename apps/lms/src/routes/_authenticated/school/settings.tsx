import { createFileRoute } from '@tanstack/react-router'
import { SchoolSettingsPage } from '@/features/school/settings'

export const Route = createFileRoute('/_authenticated/school/settings')({
  component: SchoolSettingsPage,
})
