import { createFileRoute } from '@tanstack/react-router'
import { NoticePage } from '@/features/notices'

export const Route = createFileRoute('/_app/notices/$noticeId')({
  component: function NoticeRoute() {
    const { noticeId } = Route.useParams()
    return <NoticePage noticeId={noticeId} />
  },
})
