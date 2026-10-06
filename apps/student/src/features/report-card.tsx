import { useState } from 'react'
import { FileDown, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, say } from '@/lib/backend'
import { brandColours } from '@/lib/brand'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'

/** Whether this browser can hand a PDF to the phone's share sheet; checked without loading the PDF code. */
function canShareFiles(): boolean {
  try {
    const file = new File([new Uint8Array(1)], 'x.pdf', { type: 'application/pdf' })
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/**
 * A child's report card as a PDF, to keep or send home: the child's own, or
 * — with `studentId` — one of a parent's children. It is built from what the
 * child may see, so a test's mark appears only once released.
 */
export function MyReportCard({ studentId }: { studentId?: string } = {}) {
  const me = useAuthStore((s) => s.me)
  const [busy, setBusy] = useState(false)

  const make = async (how: 'download' | 'share') => {
    if (!me) return
    setBusy(true)
    try {
      const id = studentId ?? me.userId
      const { deliverPdf, reportCardBytes, reportFileName } = await import('@ai-tutor/lms-report')
      const [card, subjects, chapters, timeline, mistakes, logo, photos, attendance, written] = await Promise.all([
        api.studentCard(id),
        api.studentSubjects(id),
        api.studentChapters(id),
        api.studentTimeline(id),
        api.studentMistakes(id),
        api.schoolLogo().catch(() => null),
        api.accountPhotos([id]).catch(() => []),
        api.studentAttendance(id).catch(() => null),
        api.reportRemark(id).catch(() => null),
      ])
      if (!card) throw new Error('The report could not be found.')
      const photo = photos[0]?.base64 ?? null
      const remark = written?.text ? { text: written.text, by: written.writtenByName ?? '' } : null
      const bytes = reportCardBytes([{ card, subjects, chapters, timeline, mistakes, photo, attendance, remark }], {
        brand: {
          schoolName: me.schoolName,
          ...brandColours(me),
          logo: logo ? { mime: logo.mime, base64: logo.base64 } : null,
        },
        generatedAt: new Date(),
      })
      const r = await deliverPdf(bytes, reportFileName(card), how, `${card.displayName} — progress report`)
      if (r === 'downloaded') toast.success('The report card is downloaded.')
    } catch (e) {
      toast.error(say(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex gap-2'>
      <Button className='h-11 flex-1' disabled={busy} onClick={() => make('download')}>
        <FileDown /> {busy ? 'Making it…' : studentId ? 'Report card (PDF)' : 'My report card (PDF)'}
      </Button>
      {canShareFiles() && (
        <Button variant='outline' className='h-11' disabled={busy} onClick={() => make('share')} aria-label='Share the report card'>
          <Share2 />
        </Button>
      )}
    </div>
  )
}
