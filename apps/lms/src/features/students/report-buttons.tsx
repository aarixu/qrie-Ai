import { useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { canSharePdf, deliverPdf, reportCardBytes, reportFileName } from '@ai-tutor/lms-report'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { brandOf, reportFor, scopeFor } from './report-pdf'

/** Download or share one student's report card as a PDF. */
export function ReportCardButtons({ studentId }: { studentId: string }) {
  const me = useAuthStore((s) => s.me)
  const [busy, setBusy] = useState<'download' | 'share' | null>(null)

  const make = async (how: 'download' | 'share') => {
    if (!me) return
    setBusy(how)
    try {
      const data = await reportFor(studentId)
      const bytes = reportCardBytes([data], { brand: await brandOf(me), generatedAt: new Date(), scopeNote: scopeFor(me) })
      const r = await deliverPdf(bytes, reportFileName(data.card), how, `${data.card.displayName} — progress report`)
      if (r === 'downloaded') toast.success('Report card downloaded.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button onClick={() => make('download')} disabled={busy !== null}>
        <Download /> {busy === 'download' ? 'Making the PDF…' : 'Report card (PDF)'}
      </Button>
      {canSharePdf() && (
        <Button variant='outline' onClick={() => make('share')} disabled={busy !== null}>
          <Share2 /> Share
        </Button>
      )}
    </>
  )
}
