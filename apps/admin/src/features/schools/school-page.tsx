import { useNavigate, useParams, useSearch as useRouteSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { admin, schools } from '@/lib/client';
import { useMe } from '@/lib/me';
import { canOperate, isOwner } from '@/lib/roles';
import { useLoad } from '@/lib/use-load';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminPage } from '@/components/admin-page';
import { LoadView } from '@/components/load-view';
import { SchoolBillingTab } from '@/features/billing/school-billing-tab';
import { ExportSchool } from './actions/export';
import { ImportPeople } from './actions/import-people';
import { Offboard } from './actions/offboard';
import { PauseTutor } from './actions/pause';
import { SetLicence } from './actions/set-licence';
import { SCHOOL_TAB_TITLE, SCHOOL_TABS, type SchoolTab } from './school-tabs';
import { ActivityTab } from './tabs/activity';
import { NotesTab } from './tabs/notes';
import { OverviewTab } from './tabs/overview';
import { PeopleTab } from './tabs/people';
import { SwitchesTab } from './tabs/switches';

type Doing = 'import' | 'pause' | 'licence' | 'export' | 'offboard' | null;

/** One school: its health, people, activity, billing, switches and Qrie's notes, and the actions on it by role. */
export function SchoolPage() {
  const me = useMe();
  const navigate = useNavigate();
  const { code } = useParams({ from: '/schools/$code' });
  const { tab } = useRouteSearch({ from: '/schools/$code' });
  const detail = useLoad(() => schools.detail(code), [code]);
  // The school's own tutor switch, for the pause button: its value here, else the global one, else the safe default.
  const flags = useLoad(() => admin.flagList(), [code]);
  const [doing, setDoing] = useState<Doing>(null);

  const tutorOn = (() => {
    if (flags.view.state !== 'ready') return null;
    const of = flags.view.data.filter((f) => f.key === 'tutor.enabled');
    const mine = of.find((f) => f.scope === 'school' && f.scopeId === code);
    const global = of.find((f) => f.scope === 'global');
    return (mine ?? global)?.value ?? of[0]?.safeDefault ?? true;
  })();

  const refresh = () => {
    detail.reload();
    flags.reload();
  };
  const ready = detail.view.state === 'ready' ? detail.view.data : null;
  const close = (o: boolean) => !o && setDoing(null);

  const actions = ready && (
    <div className='flex flex-wrap gap-2'>
      {canOperate(me.role) && (
        <>
          <Button variant='outline' onClick={() => setDoing('import')} disabled={ready.offboardedAt !== null}>
            Add people
          </Button>
          {tutorOn !== null && (
            <Button variant='outline' onClick={() => setDoing('pause')}>
              {tutorOn === false ? 'Turn the tutor back on' : 'Pause the tutor'}
            </Button>
          )}
        </>
      )}
      {isOwner(me.role) && (
        <>
          <Button variant='outline' onClick={() => setDoing('licence')}>
            Set the licence
          </Button>
          <Button variant='outline' onClick={() => setDoing('export')}>
            Export
          </Button>
          <Button variant={ready.offboardedAt ? 'outline' : 'destructive'} onClick={() => setDoing('offboard')}>
            {ready.offboardedAt ? 'Bring back' : 'Offboard'}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <AdminPage title={ready ? ready.name : code} actions={actions}>
      <LoadView view={detail.view} reload={detail.reload}>
        {(d) => (
          <>
            <div className='mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground'>
              <span className='font-mono'>{d.code}</span>
              {d.offboardedAt && <Badge variant='destructive'>Offboarded</Badge>}
              {d.quietUntil && <Badge variant='secondary'>On holiday until {d.quietUntil}</Badge>}
            </div>
            <Tabs
              value={tab}
              onValueChange={(t) => void navigate({ to: '/schools/$code', params: { code }, search: { tab: t as SchoolTab } })}
            >
              <TabsList className='mb-4 flex-wrap'>
                {SCHOOL_TABS.map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {SCHOOL_TAB_TITLE[t]}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value='overview'>
                <OverviewTab detail={d} />
              </TabsContent>
              <TabsContent value='people'>
                <PeopleTab detail={d} />
              </TabsContent>
              <TabsContent value='activity'>
                <ActivityTab code={d.code} />
              </TabsContent>
              <TabsContent value='billing'>
                <SchoolBillingTab orgId={d.orgId} code={d.code} />
              </TabsContent>
              <TabsContent value='switches'>
                <SwitchesTab code={d.code} onChanged={refresh} />
              </TabsContent>
              <TabsContent value='notes'>
                <NotesTab code={d.code} onChanged={refresh} />
              </TabsContent>
            </Tabs>
            <ImportPeople code={d.code} open={doing === 'import'} onOpenChange={close} onDone={refresh} />
            <PauseTutor code={d.code} enabled={tutorOn === false} open={doing === 'pause'} onOpenChange={close} onDone={refresh} />
            <SetLicence
              code={d.code}
              current={d.licence}
              seatsUsed={d.licence?.seatsUsed ?? d.counts.students}
              open={doing === 'licence'}
              onOpenChange={close}
              onDone={refresh}
            />
            <ExportSchool code={d.code} open={doing === 'export'} onOpenChange={close} />
            <Offboard code={d.code} offboard={d.offboardedAt === null} open={doing === 'offboard'} onOpenChange={close} onDone={refresh} />
          </>
        )}
      </LoadView>
    </AdminPage>
  );
}
