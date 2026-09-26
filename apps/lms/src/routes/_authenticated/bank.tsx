import { createFileRoute } from '@tanstack/react-router'
import { QuestionBank } from '@/features/bank'

export const Route = createFileRoute('/_authenticated/bank')({
  component: QuestionBank,
})
