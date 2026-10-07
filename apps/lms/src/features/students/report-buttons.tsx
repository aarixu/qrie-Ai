import { useState } from 'react'
import { friendlyError } from '@ai-tutor/lms-client'
import { Download, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { brandOf, reportFor, scopeFor } from './report-pdf'

/** Whether this browser can hand a PDF to the phone's share sheet; checked without loading the PDF code. */
function canShareFiles(): boolean {
  try {
    const file = new File([new Uint8Array(1)], 'x.pdf', { type: 'application/pdf' })
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/** Download or share one student's report card as a PDF. */
export function ReportCardButtons({ studentId }: { studentId: string }) {
  const me = useAuthStore((s) => s.me)
  const [busy, setBusy] = useState<'download' | 'share' | null>(null)

  const make = async (how: 'download' | 'share') => {
    if (!me) return
    setBusy(how)
    try {
      const [{ deliverPdf, reportCardBytes, reportFileName }, data] = await Promise.all([
        import('@ai-tutor/lms-report'),
        reportFor(studentId),
      ])
      const bytes = reportCardBytes([data], { brand: await brandOf(me), generatedAt: new Date(), scopeNote: scopeFor(me) })
      const r = await deliverPdf(bytes, reportFileName(data.card), how, `${data.card.displayName} — progress report`)
      if (r === 'downloaded') toast.success('Report card downloaded.')
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button onClick={() => make('download')} disabled={busy !== null}>
        <Download /> {busy === 'download' ? 'Making the PDF…' : 'Report card (PDF)'}
      </Button>
      {canShareFiles() && (
        <Button variant='outline' onClick={() => make('share')} disabled={busy !== null}>
          <Share2 /> Share
        </Button>
      )}
    </>
  )
}
