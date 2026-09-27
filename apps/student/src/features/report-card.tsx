import { useState } from 'react'
import { FileDown, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { canSharePdf, deliverPdf, reportCardBytes, reportFileName } from '@ai-tutor/lms-report'
import { api, say } from '@/lib/backend'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'

/**
 * The child's own report card as a PDF, to keep or send home. It is built
 * from what the child may see, so a test's mark appears only once released.
 */
export function MyReportCard() {
  const me = useAuthStore((s) => s.me)
  const [busy, setBusy] = useState(false)

  const make = async (how: 'download' | 'share') => {
    if (!me) return
    setBusy(true)
    try {
      const id = me.userId
      const [card, subjects, chapters, timeline, mistakes, logo] = await Promise.all([
        api.studentCard(id),
        api.studentSubjects(id),
        api.studentChapters(id),
        api.studentTimeline(id),
        api.studentMistakes(id),
        api.schoolLogo().catch(() => null),
      ])
      if (!card) throw new Error('Your report could not be found.')
      const bytes = reportCardBytes([{ card, subjects, chapters, timeline, mistakes }], {
        brand: {
          schoolName: me.schoolName,
          primary: typeof me.brand?.primary === 'string' ? me.brand.primary : null,
          logo: logo ? { mime: logo.mime, base64: logo.base64 } : null,
        },
        generatedAt: new Date(),
      })
      const r = await deliverPdf(bytes, reportFileName(card), how, `${card.displayName} — progress report`)
      if (r === 'downloaded') toast.success('Your report card is downloaded.')
    } catch (e) {
      toast.error(say(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex gap-2'>
      <Button className='h-11 flex-1' disabled={busy} onClick={() => make('download')}>
        <FileDown /> {busy ? 'Making it…' : 'My report card (PDF)'}
      </Button>
      {canSharePdf() && (
        <Button variant='outline' className='h-11' disabled={busy} onClick={() => make('share')} aria-label='Share my report card'>
          <Share2 />
        </Button>
      )}
    </div>
  )
}
