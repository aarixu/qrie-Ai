import type { SchoolDetail } from '@ai-tutor/admin-client';
import { schools } from '@/lib/client';
import { useMe } from '@/lib/me';
import { canOperate } from '@/lib/roles';
import { useLoad } from '@/lib/use-load';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadView } from '@/components/load-view';
import { HealthCard } from '../health-card';

/** The health card, the licence, the year, the counts and, for owner and ops, the school's contacts. */
export function OverviewTab({ detail }: { detail: SchoolDetail }) {
  const me = useMe();
  const c = detail.counts;
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <HealthCard health={detail.health} />
      <div className='space-y-4'>
        <Card>
          <CardHeader>
            <CardDescription>Licence</CardDescription>
            {detail.licence ? (
              <CardTitle className='text-base'>
                {detail.licence.plan}: {detail.licence.seatsUsed} of {detail.licence.seats} seats used
              </CardTitle>
            ) : (
              <CardTitle className='text-base text-muted-foreground'>No licence is set</CardTitle>
            )}
          </CardHeader>
          {detail.licence && (
            <CardContent className='text-sm text-muted-foreground'>
              Last day {detail.licence.validUntil}
              {detail.licence.daysLeft < 0 ? ', ended.' : `, ${detail.licence.daysLeft} days left.`}
            </CardContent>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>This year</CardDescription>
            <CardTitle className='text-base'>
              {detail.year ? `${detail.year.label}: ${detail.year.startsOn} to ${detail.year.endsOn}` : 'No year is set up'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className='grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3'>
              <Count label='Students' n={c.students} />
              <Count label='Teachers' n={c.teachers} />
              <Count label='Admins' n={c.admins} />
              <Count label='Parents' n={c.parents} />
              <Count label='Left' n={c.left} />
              <Count label='Students who ever used it' n={c.studentsEverUsed} />
              <Count label='Teachers who ever used it' n={c.teachersEverUsed} />
            </dl>
            <p className='mt-3 text-xs text-muted-foreground'>
              Board {detail.board}; on Qrie since {detail.createdOn}.
            </p>
          </CardContent>
        </Card>
        {canOperate(me.role) && <Contacts code={detail.code} />}
      </div>
    </div>
  );
}

function Count({ label, n }: { label: string; n: number }) {
  return (
    <div>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='font-medium'>{n}</dd>
    </div>
  );
}

function Contacts({ code }: { code: string }) {
  const { view, reload } = useLoad(() => schools.notes(code), [code]);
  return (
    <Card>
      <CardHeader>
        <CardDescription>People to call at the school</CardDescription>
      </CardHeader>
      <CardContent>
        <LoadView view={view} reload={reload} skeletons={1}>
          {(n) =>
            n.contacts.length === 0 ? (
              <p className='text-sm text-muted-foreground'>None yet. Add one on the Notes tab.</p>
            ) : (
              <ul className='space-y-1 text-sm'>
                {n.contacts.map((ct) => (
                  <li key={ct.id}>
                    <span className='font-medium'>{ct.name}</span>, {ct.role}: {[ct.phone, ct.email].filter(Boolean).join(', ')}
                  </li>
                ))}
              </ul>
            )
          }
        </LoadView>
      </CardContent>
    </Card>
  );
}
