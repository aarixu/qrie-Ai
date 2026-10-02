import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { formatDistanceToNowStrict } from 'date-fns'
import { FileDown, Search, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { classFileName, deliverPdf, reportCardBytes } from '@ai-tutor/lms-report'
import { useAuthStore } from '@/stores/auth-store'
import type { SchoolStudent } from '@ai-tutor/lms-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loading, Page, Problem } from '@/components/layout/page'
import { MEASURE, band, pct } from '@/features/analytics/charts'
import { PersonAvatar } from '@/components/person-avatar'
import { hueFor } from '@/lib/palette'
import { usePhotos } from '@/lib/photos'
import { PhotoUploadButton } from './photo-upload'
import { brandOf, inTurn, reportFor } from '@/features/students/report-pdf'
import { useSchoolClasses, useSchoolStudents } from './overview'

const ALL = 'all'
type BandFilter = 'all' | 'help' | 'there' | 'secure' | 'none'

function inBand(s: SchoolStudent, f: BandFilter): boolean {
  if (f === 'all') return true
  if (f === 'none') return s.mastery === null
  if (s.mastery === null) return false
  if (f === 'help') return s.mastery < 0.4
  if (f === 'there') return s.mastery >= 0.4 && s.mastery < 0.7
  return s.mastery >= 0.7
}

/** Every student in the school as a card, by class (lms.school_students). */
export function SchoolStudentsPage({ section }: { section?: string }) {
  const navigate = useNavigate()
  const classes = useSchoolClasses()
  const students = useSchoolStudents(section)
  const [query, setQuery] = useState('')
  const [bandFilter, setBandFilter] = useState<BandFilter>('all')
  const photos = usePhotos((students.data ?? []).map((x) => x.userId))
  const sections = [...new Map((classes.data ?? []).map((c) => [c.sectionId, c.className])).entries()]

  const shown = (students.data ?? []).filter(
    (s) =>
      inBand(s, bandFilter) &&
      (!query.trim() ||
        s.displayName.toLowerCase().includes(query.trim().toLowerCase()) ||
        s.loginId.toLowerCase().includes(query.trim().toLowerCase()))
  )

  return (
    <Page
      title='Students'
      description='Every student’s card. Open one for their full report, subject by subject.'
      actions={
        <>
          <PhotoUploadButton />
          <Button asChild variant='outline'>
            <Link to='/school/people'>
              <UserPlus /> Add students
            </Link>
          </Button>
        </>
      }
    >
      <div className='mb-4 flex flex-wrap gap-2'>
        <div className='relative'>
          <Search className='absolute top-2.5 left-2.5 size-4 text-muted-foreground' />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search by name or ID'
            className='w-64 ps-8'
            aria-label='Search students'
          />
        </div>
        <Select
          value={section ?? ALL}
          onValueChange={(v) => navigate({ to: '/school/students', search: v === ALL ? {} : { section: v } })}
        >
          <SelectTrigger className='w-40' aria-label='Class'>
            <SelectValue placeholder='Class' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All classes</SelectItem>
            {sections.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                Class {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={bandFilter} onValueChange={(v) => setBandFilter(v as BandFilter)}>
          <SelectTrigger className='w-44' aria-label='Mastery'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Any mastery</SelectItem>
            <SelectItem value='help'>Needs help</SelectItem>
            <SelectItem value='there'>Getting there</SelectItem>
            <SelectItem value='secure'>Secure</SelectItem>
            <SelectItem value='none'>No answers yet</SelectItem>
          </SelectContent>
        </Select>
        {students.data && (
          <span className='self-center text-sm text-muted-foreground'>
            {shown.length} of {students.data.length}
          </span>
        )}
        <AllCards
          students={shown}
          name={section ? sections.find(([id]) => id === section)?.[1] ?? 'class' : 'all'}
        />
      </div>
      {students.isPending ? (
        <Loading what='the students' />
      ) : students.isError ? (
        <Problem error={students.error} />
      ) : shown.length === 0 ? (
        <p className='text-muted-foreground'>No students match.</p>
      ) : (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {shown.map((s) => (
            <StudentCard key={s.userId} s={s} photo={photos.get(s.userId)} />
          ))}
        </div>
      )}
    </Page>
  )
}

function StudentCard({ s, photo }: { s: SchoolStudent; photo: string | undefined }) {
  const b = band(s.mastery)
  const classHue = hueFor(s.className)
  return (
    <Link
      to='/students/$studentId'
      params={{ studentId: s.userId }}
      className='rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
    >
      <Card className='h-full gap-0 overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:shadow-md'>
        <div
          className='relative h-14'
          style={{ background: `linear-gradient(120deg, ${classHue.solid}33, ${classHue.solid}0d)` }}
        >
          <span
            className='absolute top-2 right-3 rounded-full px-2 py-0.5 text-xs font-semibold'
            style={{ background: classHue.soft, color: classHue.solid }}
          >
            Class {s.className}
          </span>
        </div>
        <CardContent className='-mt-8 space-y-3 px-4 pb-4'>
          <div className='flex items-end gap-3'>
            <PersonAvatar
              userId={s.userId}
              name={s.displayName}
              photo={photo}
              ring={b.colour}
              className='size-16 border-4 border-card'
            />
            <div className='min-w-0 pb-1'>
              <p className='truncate font-semibold'>{s.displayName}</p>
              <p className='text-xs text-muted-foreground'>
                Roll {s.rollNumber ?? '—'} · <span className='font-mono'>{s.loginId}</span>
              </p>
            </div>
          </div>
          <div className='grid grid-cols-3 gap-2 text-center'>
            <Stat label='Handed in' value={pct(s.handinRate)} colour={MEASURE.handin} bad={(s.handinRate ?? 1) < 0.6} />
            <Stat label='Average' value={pct(s.averageScore)} colour={MEASURE.average} bad={(s.averageScore ?? 1) < 0.5} />
            <Stat label='Mastery' value={pct(s.mastery)} colour={b.colour} />
          </div>
          <div className='flex items-center justify-between text-xs'>
            <span className={cn('font-medium', b.text)}>{b.label}</span>
            <span className='text-muted-foreground'>
              {s.lastActive
                ? `Active ${formatDistanceToNowStrict(new Date(s.lastActive), { addSuffix: true })}`
                : 'Not active yet'}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function Stat({ label, value, colour, bad }: { label: string; value: string; colour: string; bad?: boolean }) {
  return (
    <div className='rounded-lg px-1 py-1.5' style={{ background: `${colour}14` }}>
      <p
        className={cn('text-sm font-bold tabular-nums', bad && 'text-destructive')}
        style={bad ? undefined : { color: `color-mix(in oklab, ${colour} 72%, black)` }}
      >
        {value}
      </p>
      <p className='text-[10px] text-muted-foreground uppercase'>{label}</p>
    </div>
  )
}

/**
 * Every shown student's report card in one PDF, a page or more each, for
 * printing or sending to a class's parents in one go.
 */
function AllCards({ students, name }: { students: SchoolStudent[]; name: string }) {
  const me = useAuthStore((s) => s.me)
  const [made, setMade] = useState<number | null>(null)
  const make = async () => {
    if (!me || students.length === 0) return
    setMade(0)
    try {
      const reports = await inTurn(students, 4, (s) => reportFor(s.userId), setMade)
      const bytes = reportCardBytes(reports, { brand: await brandOf(me), generatedAt: new Date() })
      const file = name === 'all' ? 'All-students-report-cards.pdf' : classFileName(name)
      await deliverPdf(bytes, file, 'download', `${me.schoolName} — report cards`)
      toast.success(`${reports.length} report cards downloaded.`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setMade(null)
    }
  }
  return (
    <Button variant='outline' className='ms-auto' disabled={made !== null || students.length === 0} onClick={make}>
      <FileDown />{' '}
      {made !== null ? `Making ${made} of ${students.length}…` : `Report cards for these ${students.length} (PDF)`}
    </Button>
  )
}
