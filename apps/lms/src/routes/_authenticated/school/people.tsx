import { createFileRoute } from '@tanstack/react-router'
import { SchoolImportPage } from '@/features/school/import'

export const Route = createFileRoute('/_authenticated/school/people')({
  component: SchoolImportPage,
})
