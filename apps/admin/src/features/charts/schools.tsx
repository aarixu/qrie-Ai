import type { ChartSeries } from '@ai-tutor/admin-client';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartCard } from '@/components/charts/chart-card';
import { NotCaptured } from '@/components/charts/not-captured';
import { ChartGrid, ChartsFrame, LinesCard, metricOf } from './frame';
import { healthByDay, latestBySchool, quietGrid, SUPPRESSED_TEXT, totalByDay, type DayPoint } from './model';

/**
 * Schools over time: health, seats, activation, hand-ins, homework published,
 * quiet schools and sign-ins, for every school or one (?school=). A figure
 * about a school's children is hidden for a school with fewer than 10 students.
 */
export function ChartsSchools() {
  return (
    <ChartsFrame page='schools' title='Charts: Schools' schoolPicker>
      {({ series, school }) => <SchoolsBody series={series} school={school} />}
    </ChartsFrame>
  );
}

const LEVELS = [
  { level: 'green', label: 'Green' },
  { level: 'amber', label: 'Amber' },
  { level: 'red', label: 'Red' },
  { level: 'grey', label: 'Grey' },
] as const;

const pct = (n: number | null, of: number | null): string =>
  n === null || of === null || of === 0 ? '—' : `${Math.round((n * 100) / of)}%`;

function SchoolsBody({ series, school }: { series: ChartSeries; school: string | null }) {
  const health = metricOf(series, 'school.health');
  const used = metricOf(series, 'school.seats_used');
  const bought = metricOf(series, 'school.seats_bought');
  const activated = metricOf(series, 'school.activated');
  const handed = metricOf(series, 'school.handed_in_7d');
  const students = metricOf(series, 'school.students');
  const active = metricOf(series, 'school.active');
  const signins = metricOf(series, 'school.signins');
  const published = metricOf(series, 'school.homework_published');

  const byLevel = health ? healthByDay(health) : [];
  const studentsBySchool = new Map((students ? latestBySchool(students) : []).map((r) => [r.school, r.value]));
  const activatedBySchool = new Map((activated ? latestBySchool(activated) : []).map((r) => [r.school, r]));
  const handedBySchool = new Map((handed ? latestBySchool(handed) : []).map((r) => [r.school, r]));
  const codes = [...new Set([...studentsBySchool.keys(), ...activatedBySchool.keys(), ...handedBySchool.keys()])].sort();

  return (
    <div className='space-y-6'>
      <ChartGrid>
        {health && (
          <LinesCard
            title='Health over time'
            description={school ? `${school}'s health level, as the nightly run saw it.` : 'Schools at each health level, as the nightly run saw them.'}
            kind='stacked'
            unit='count'
            lines={LEVELS.map((l) => ({
              label: l.label,
              points: byLevel.map(
                (d): DayPoint => (d[l.level] === null ? { day: d.day, value: null, state: 'no-figure' } : { day: d.day, value: d[l.level], state: 'value' }),
              ),
            }))}
          />
        )}
        {used && bought && (
          <LinesCard
            title='Seats used and bought'
            description={school ? undefined : 'Added up over every school.'}
            unit='count'
            lines={[
              { label: 'Used', points: totalByDay(used) },
              { label: 'Bought', points: totalByDay(bought), asLine: true },
            ]}
          />
        )}
        {published && (
          <LinesCard
            title='Homework published per day'
            description={school ? undefined : 'Added up over every school.'}
            unit='count'
            lines={[{ label: 'Published', points: totalByDay(published) }]}
          />
        )}
      </ChartGrid>

      <ChartCard
        title='Activation and hand-ins by school'
        description='The latest night: students who have done anything, and who handed in work in the 7 days before. A school with fewer than 10 students shows its student count but not these two figures.'
      >
        {codes.length === 0 ? (
          <p className='px-4 text-sm text-muted-foreground'>No figure for this window yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>School</TableHead>
                <TableHead className='text-right'>Students</TableHead>
                <TableHead className='text-right'>Have done anything</TableHead>
                <TableHead className='text-right'>Handed in, 7 days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map((code) => {
                const n = studentsBySchool.get(code) ?? null;
                const a = activatedBySchool.get(code);
                const h = handedBySchool.get(code);
                return (
                  <TableRow key={code}>
                    <TableCell className='font-mono text-xs'>{code}</TableCell>
                    <TableCell className='text-right tabular-nums'>{n ?? '—'}</TableCell>
                    <TableCell className='text-right tabular-nums'>{!a ? '—' : a.suppressed ? SUPPRESSED_TEXT : pct(a.value, n)}</TableCell>
                    <TableCell className='text-right tabular-nums'>{!h ? '—' : h.suppressed ? SUPPRESSED_TEXT : pct(h.value, n)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ChartCard>

      {active && <QuietGrid metric={active} />}

      {signins && !signins.captured ? (
        <NotCaptured label='Sign-ins per school' why={signins.why} />
      ) : (
        signins && <SignIns metric={signins} />
      )}
    </div>
  );
}

function QuietGrid({ metric }: { metric: NonNullable<ReturnType<typeof metricOf>> }) {
  const rows = quietGrid(metric);
  return (
    <ChartCard title='Quiet schools' description='A filled cell is a day with any activity; an empty one, none; grey, no figure.'>
      {rows.length === 0 ? (
        <p className='px-4 text-sm text-muted-foreground'>No figure for this window yet.</p>
      ) : (
        <div className='space-y-1 overflow-x-auto px-4'>
          {rows.map((r) => (
            <div key={r.school} className='flex items-center gap-2'>
              <span className='w-16 shrink-0 font-mono text-xs'>{r.school}</span>
              <div className='flex gap-0.5'>
                {r.days.map((d) => (
                  <span
                    key={d.day}
                    title={`${d.day}: ${d.active === null ? 'no figure' : d.active ? 'active' : 'quiet'}`}
                    className={cn(
                      'size-3.5 rounded-sm border',
                      d.active === null && 'border-transparent bg-muted',
                      d.active === true && 'border-transparent bg-emerald-500',
                      d.active === false && 'border-muted-foreground/40 bg-transparent',
                    )}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

function SignIns({ metric }: { metric: NonNullable<ReturnType<typeof metricOf>> }) {
  const bySchool = new Map<string, { sum: number; hidden: boolean }>();
  for (const p of metric.points) {
    if (!p.school || p.dim !== '') continue;
    const r = bySchool.get(p.school) ?? { sum: 0, hidden: false };
    if (p.suppressed || p.value === null) r.hidden = true;
    else r.sum += p.value;
    bySchool.set(p.school, r);
  }
  const rows = [...bySchool.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return (
    <ChartCard
      title='Sign-ins per school'
      description='Students whose last sign-in fell on each day, added up over the window: a student is counted once a day.'
    >
      {rows.length === 0 ? (
        <p className='px-4 text-sm text-muted-foreground'>No figure for this window yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>School</TableHead>
              <TableHead className='text-right'>Sign-ins</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([code, r]) => (
              <TableRow key={code}>
                <TableCell className='font-mono text-xs'>{code}</TableCell>
                <TableCell className='text-right tabular-nums'>{r.hidden ? SUPPRESSED_TEXT : r.sum}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ChartCard>
  );
}
