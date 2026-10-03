import { useState } from 'react'
import { friendlyError } from '@ai-tutor/lms-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, Eye, EyeOff, FileSpreadsheet, Upload, Users, XCircle } from 'lucide-react'
import {
  credentialsCsv,
  STUDENTS_TEMPLATE,
  TEACHERS_TEMPLATE,
  type HeadingRead,
  type ImportColumns,
  type ImportResponse,
  type ImportSeats,
} from '@ai-tutor/lms-client'
import { backend } from '@/lib/backend'
import { downloadText } from '@/lib/download'
import { cn } from '@/lib/utils'
import { uuid } from '@/lib/uuid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Page } from '@/components/layout/page'
import { LicenceBanner } from './licence'

type Sheet = { name: string; text: string }
const MAX_BYTES = 1_000_000

const COLUMNS = {
  students: [
    ['grade', 'Class number, 1 to 12', '8'],
    ['section', 'Section letter', 'A'],
    ['roll', 'Roll number in that section', '12'],
    ['name', 'Full name', 'Kavya Iyer'],
    ['admission_no', 'Optional. Keeps the same ID year after year', 'A1024'],
  ],
  teachers: [
    ['name', 'Full name', 'Sunita Rao'],
    ['teaches', 'Classes and subjects, separated by ;', '8A Mathematics; 8B Mathematics'],
    ['role', 'Optional. teacher (the default) or admin', 'teacher'],
    ['staff_id', 'Optional. Your staff number, used in the ID', 'T12'],
  ],
} as const

/**
 * The admin adds students and teachers from two sheets: download the blank
 * templates, fill them in, upload them, read what the server's check found,
 * then add everyone and download their IDs and PINs — shown this once only.
 */
export function SchoolImportPage() {
  const queryClient = useQueryClient()
  const [students, setStudents] = useState<Sheet | null>(null)
  const [teachers, setTeachers] = useState<Sheet | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [showPins, setShowPins] = useState(false)

  const request = { students: students?.text, teachers: teachers?.text }
  // One key per checked pair of sheets: pressing the button again after a
  // lost answer sends the same key, and the server gives the same PINs back.
  const [importKey, setImportKey] = useState(uuid)
  const check = useMutation({
    mutationFn: () => backend.importPeople(request),
    onSuccess: () => {
      setImportKey(uuid())
      setAccepted(false)
    },
  })
  const commit = useMutation({
    mutationFn: () => backend.importPeople({ ...request, commit: true, acceptWarnings: accepted, importKey }),
    onSuccess: (r) => {
      if (r.committed) queryClient.invalidateQueries({ queryKey: ['school'] })
    },
  })
  // While a commit is on its way, nothing may throw its answer (the PINs) away.
  const locked = commit.isPending

  const reset = () => {
    setStudents(null)
    setTeachers(null)
    setAccepted(false)
    setShowPins(false)
    check.reset()
    commit.reset()
  }

  const pick = (which: 'students' | 'teachers') => async (file: File | undefined) => {
    if (locked) return
    setPickError(null)
    check.reset()
    commit.reset()
    setAccepted(false)
    if (!file) return
    if (/\.(xlsx?|ods|numbers)$/i.test(file.name)) {
      setPickError(`${file.name} is a spreadsheet file. Save it as CSV first (File → Save as → CSV UTF-8), then upload that.`)
      return
    }
    if (file.size > MAX_BYTES) {
      setPickError(`${file.name} is larger than 1 MB.`)
      return
    }
    const sheet = { name: file.name, text: await file.text() }
    if (which === 'students') setStudents(sheet)
    else setTeachers(sheet)
  }

  const done = commit.data?.committed ? commit.data : null
  const shown: ImportResponse | undefined = commit.data && !commit.data.committed ? commit.data : check.data

  return (
    <Page
      title='Add students and teachers'
      description='Fill in the templates, upload them, check, and add. Everyone gets an ID and a PIN.'
    >
      <LicenceBanner className='mb-6' />
      {done ? (
        <Done
          result={done}
          showPins={showPins}
          onTogglePins={() => setShowPins((v) => !v)}
          onAgain={reset}
        />
      ) : (
        <div className='space-y-6'>
          <Card>
            <CardHeader>
              <CardTitle>1. Download the templates</CardTitle>
              <CardDescription>
                Open them in Excel or Google Sheets, add one row per person, and save as CSV. Your school’s own sheet
                works too: headings like Student Name, Roll No. or Class are understood, and the check shows how each
                one was read.
              </CardDescription>
            </CardHeader>
            <CardContent className='grid gap-6 xl:grid-cols-2'>
              {(['students', 'teachers'] as const).map((which) => (
                <div key={which} className='space-y-3'>
                  <Button
                    variant='outline'
                    onClick={() =>
                      downloadText(`${which}-template.csv`, which === 'students' ? STUDENTS_TEMPLATE : TEACHERS_TEMPLATE)
                    }
                  >
                    <Download /> {which === 'students' ? 'Students template' : 'Teachers template'}
                  </Button>
                  <div className='overflow-x-auto rounded-md border'>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Column</TableHead>
                          <TableHead>What to write</TableHead>
                          <TableHead>Example</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {COLUMNS[which].map(([col, what, eg]) => (
                          <TableRow key={col}>
                            <TableCell className='font-mono text-xs'>{col}</TableCell>
                            <TableCell className='text-sm'>{what}</TableCell>
                            <TableCell className='font-mono text-xs text-muted-foreground'>{eg}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Upload the filled sheets</CardTitle>
              <CardDescription>One or both. Nothing is added until you check and confirm.</CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='grid gap-4 sm:grid-cols-2'>
                <FilePick label='Students sheet' sheet={students} onPick={pick('students')} disabled={locked} />
                <FilePick label='Teachers sheet' sheet={teachers} onPick={pick('teachers')} disabled={locked} />
              </div>
              {pickError && <p className='text-sm text-destructive'>{pickError}</p>}
              <Button disabled={(!students && !teachers) || check.isPending || locked} onClick={() => check.mutate()}>
                {check.isPending ? 'Checking…' : 'Check the sheets'}
              </Button>
              {check.isError && <p className='text-sm text-destructive'>{friendlyError(check.error)}</p>}
            </CardContent>
          </Card>

          {shown && (
            <Checked
              result={shown}
              accepted={accepted}
              onAccept={setAccepted}
              adding={commit.isPending}
              onAdd={() => commit.mutate()}
              error={
                commit.isError
                  ? commit.error instanceof TypeError
                    ? 'The school server did not answer. Press the button again: if the people were added, the same IDs and PINs come back.'
                    : friendlyError(commit.error)
                  : null
              }
            />
          )}
        </div>
      )}
    </Page>
  )
}

function FilePick({
  label,
  sheet,
  onPick,
  disabled,
}: {
  label: string
  sheet: Sheet | null
  onPick: (f: File | undefined) => void
  disabled: boolean
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors hover:bg-accent/50',
        sheet && 'border-primary/50 bg-primary/5',
        disabled && 'pointer-events-none opacity-60'
      )}
    >
      {sheet ? <FileSpreadsheet className='size-6 text-primary' /> : <Upload className='size-6 text-muted-foreground' />}
      <span className='min-w-0 flex-1'>
        <span className='block font-medium'>{label}</span>
        <span className='block truncate text-sm text-muted-foreground'>
          {sheet ? `${sheet.name} · ${Math.max(0, sheet.text.trim().split(/\r?\n/).length - 1)} rows` : 'Choose a .csv file'}
        </span>
      </span>
      <input
        type='file'
        accept='.csv,text/csv'
        className='sr-only'
        disabled={disabled}
        onChange={(e) => {
          onPick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </label>
  )
}

function Checked({
  result,
  accepted,
  onAccept,
  adding,
  onAdd,
  error,
}: {
  result: ImportResponse
  accepted: boolean
  onAccept: (v: boolean) => void
  adding: boolean
  onAdd: () => void
  error: string | null
}) {
  const fresh = result.people.filter((p) => p.status === 'new')
  const already = result.people.length - fresh.length
  const blocked = result.errors.length > 0 || (result.warnings.length > 0 && !accepted) || result.changes === 0
  const label =
    result.changes === 0
      ? 'Nothing to change'
      : fresh.length > 0
        ? `Add ${fresh.length} ${fresh.length === 1 ? 'person' : 'people'}`
        : `Save ${result.changes} ${result.changes === 1 ? 'change' : 'changes'}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>3. Check and add</CardTitle>
        <CardDescription>
          {result.errors.length > 0
            ? 'The sheets have mistakes. Fix them in the sheet, save, and upload again.'
            : `${fresh.length} new ${fresh.length === 1 ? 'person' : 'people'} to add` +
              (already ? `, ${already} already in the school (no new PIN).` : '.') +
              (result.changes > fresh.length ? ' Some already there are given classes.' : '')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <HeadingsRead columns={result.columns} />
        {result.seats && <Seats seats={result.seats} checked={result.errors.length === 0} />}
        {result.errors.length > 0 && (
          <ul className='space-y-1 rounded-md bg-destructive/10 p-3 text-sm text-destructive'>
            {result.errors.map((e) => (
              <li key={e} className='flex gap-2'>
                <XCircle className='mt-0.5 size-4 shrink-0' /> {e}
              </li>
            ))}
          </ul>
        )}
        {result.errors.length === 0 && result.warnings.length > 0 && (
          <div className='space-y-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300'>
            <ul className='space-y-1'>
              {result.warnings.map((w) => (
                <li key={w} className='flex gap-2'>
                  <AlertTriangle className='mt-0.5 size-4 shrink-0' /> {w}
                </li>
              ))}
            </ul>
            <label className='flex items-center gap-2 font-medium'>
              <Checkbox checked={accepted} onCheckedChange={(v) => onAccept(v === true)} />
              I have read these, and want to go ahead.
            </label>
          </div>
        )}
        {result.errors.length === 0 && result.people.length > 0 && (
          <div className='max-h-96 overflow-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Class / teaches</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.people.map((p) => (
                  <TableRow key={p.loginId}>
                    <TableCell>
                      {p.status === 'new' ? <Badge>New</Badge> : <Badge variant='secondary'>Already there</Badge>}
                    </TableCell>
                    <TableCell className='font-mono text-sm'>{p.loginId}</TableCell>
                    <TableCell className='font-medium'>{p.displayName}</TableCell>
                    <TableCell className='capitalize'>{p.kind}</TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {p.className ? `${p.className} · Roll ${p.roll}` : (p.teaches ?? []).join('; ') || '—'}
                      {p.adds && p.adds.length > 0 && (
                        <span className='block font-medium text-amber-700 dark:text-amber-400'>Adds: {p.adds.join('; ')}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {error && <p className='text-sm text-destructive'>{error}</p>}
        {result.errors.length === 0 && (
          <Button disabled={blocked || adding} onClick={onAdd}>
            {adding ? 'Saving…' : label}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * How the server read each sheet's first row: every heading, and the column
 * it was taken as, or that it was not read — so a school's own headings can
 * be checked before anyone is added.
 */
function HeadingsRead({ columns }: { columns: ImportColumns | undefined }) {
  const sheets: [string, HeadingRead[]][] = []
  if (columns?.students?.length) sheets.push(['Students sheet', columns.students])
  if (columns?.teachers?.length) sheets.push(['Teachers sheet', columns.teachers])
  if (sheets.length === 0) return null
  return (
    <div className='space-y-2'>
      {sheets.map(([label, list]) => (
        <div key={label} className='text-sm'>
          <p className='font-medium'>{label}: how each heading was read</p>
          <ul className='mt-1 flex flex-wrap gap-1.5'>
            {list.map((c, i) => (
              <li key={i}>
                <Badge variant={c.column ? 'secondary' : 'outline'} className='font-normal'>
                  {c.heading}
                  <span aria-hidden>→</span>
                  <span className={cn('font-mono', !c.column && 'text-muted-foreground')}>{c.column ?? 'not read'}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The licence's seats: how many remain, and — once the sheets check out — how many they take. */
function Seats({ seats, checked }: { seats: ImportSeats; checked: boolean }) {
  const left = Math.max(0, seats.total - seats.used)
  return (
    <p className='flex items-center gap-2 text-sm text-muted-foreground'>
      <Users className='size-4 shrink-0' />
      <span>
        {seats.used} of {seats.total} seats in use, {left === 0 ? 'none' : left} left.
        {checked && seats.adding > 0 && ` These sheets take ${seats.adding}, leaving ${left - seats.adding}.`}
      </span>
    </p>
  )
}

function Done({
  result,
  showPins,
  onTogglePins,
  onAgain,
}: {
  result: ImportResponse
  showPins: boolean
  onTogglePins: () => void
  onAgain: () => void
}) {
  const save = () =>
    downloadText(`${result.schoolCode}-new-ids-and-pins.csv`, credentialsCsv(result.schoolCode, result.created))
  return (
    <div className='space-y-6'>
      <Card className='border-green-600/40'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <CheckCircle2 className='size-5 text-green-600' />{' '}
            {result.created.length > 0
              ? `Added ${result.created.length} ${result.created.length === 1 ? 'person' : 'people'}`
              : 'Saved'}
          </CardTitle>
          <CardDescription>
            {result.created.length > 0
              ? 'Download their IDs and PINs now and keep the file safe. PINs are not stored anywhere they can be read back; if one is lost, give that person a new PIN: open the student from Students, or find the teacher under Teachers.'
              : 'The classes were added. Nobody new was created, so there are no new PINs.'}
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-wrap gap-2'>
          <Button onClick={save} disabled={result.created.length === 0}>
            <Download /> Download IDs and PINs (CSV)
          </Button>
          <Button variant='outline' onClick={onTogglePins}>
            {showPins ? <EyeOff /> : <Eye />} {showPins ? 'Hide PINs' : 'Show PINs'}
          </Button>
          <Button variant='ghost' onClick={onAgain}>
            Add more people
          </Button>
        </CardContent>
      </Card>
      {result.conflicts.length > 0 && (
        <ul className='space-y-1 rounded-md bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300'>
          {result.conflicts.map((c) => (
            <li key={c} className='flex gap-2'>
              <AlertTriangle className='mt-0.5 size-4 shrink-0' /> {c}
            </li>
          ))}
        </ul>
      )}
      {result.created.length > 0 && (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>ID</TableHead>
                <TableHead>PIN</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.created.map((c) => (
                <TableRow key={c.loginId}>
                  <TableCell className='font-medium'>{c.displayName}</TableCell>
                  <TableCell className='capitalize'>{c.kind}</TableCell>
                  <TableCell>{c.className ? `${c.className} · Roll ${c.roll}` : '—'}</TableCell>
                  <TableCell className='font-mono text-sm'>{c.loginId}</TableCell>
                  <TableCell className='font-mono text-sm tracking-wider'>{showPins ? c.pin : '••••••'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
