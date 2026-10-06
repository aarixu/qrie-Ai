import type { RelayStatus, Today as TodayData } from '@ai-tutor/admin-client';
import { useCallback, useEffect, useState } from 'react';
import { admin } from '@/lib/client';
import { loadToday } from '@/lib/load-today';
import { schoolNotes, tilesFor, type Tone } from '@/lib/tiles';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminPage } from '@/components/admin-page';
import { StopControl } from '@/components/stop-control';

const TONE: Record<Tone, string> = {
  ok: 'border-l-4 border-l-emerald-500',
  warn: 'border-l-4 border-l-amber-500',
  bad: 'border-l-4 border-l-red-600',
  grey: 'border-l-4 border-l-muted-foreground/40',
};

const REFRESH_MS = 30_000;

/** The home page: what needs a person today, from one database function. */
export function Today() {
  const [today, setToday] = useState<TodayData | null>(null);
  const [relay, setRelay] = useState<RelayStatus | null>(null);
  const [error, setError] = useState('');

  // The two reads stand apart (loadToday): the stop button appears as soon as
  // relay_status answers, even when today() fails. A failed refresh keeps the
  // last good value on screen.
  const load = useCallback(async () => {
    const r = await loadToday(admin);
    if (r.today) setToday(r.today);
    if (r.relay) setRelay(r.relay);
    setError(r.error);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const notes = today ? schoolNotes(today) : [];
  return (
    <AdminPage title='Today' actions={relay && <StopControl status={relay} onChanged={() => void load()} />}>
      {error && (
        <Alert variant='destructive' className='mb-4'>
          <AlertDescription>{today ? `Could not refresh: ${error}` : error}</AlertDescription>
        </Alert>
      )}
      {!today ? (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className='h-28' />
          ))}
        </div>
      ) : (
        <div className='space-y-6'>
          <section aria-label='Status' className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            {tilesFor(today).map((t) => (
              <Card key={t.key} className={cn('gap-2 py-4', TONE[t.tone])}>
                <CardHeader className='px-4'>
                  <CardDescription>{t.label}</CardDescription>
                  <CardTitle className='text-xl'>{t.value}</CardTitle>
                </CardHeader>
                <CardContent className='px-4 text-xs text-muted-foreground'>{t.detail}</CardContent>
              </Card>
            ))}
          </section>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>Schools that need attention</CardTitle>
              <CardDescription>A licence ending within 30 days, or seats nearly all taken.</CardDescription>
            </CardHeader>
            <CardContent>
              {notes.length === 0 ? (
                <p className='text-sm text-muted-foreground'>None today.</p>
              ) : (
                <ul className='space-y-2'>
                  {notes.map((n, i) => (
                    <li key={`${n.code}-${i}`} className={cn('rounded-md bg-muted/40 px-3 py-2 text-sm', TONE[n.tone])}>
                      {n.text}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <p className='text-xs text-muted-foreground'>
            Refreshes every 30 seconds. Updated {new Date(today.generatedAt).toLocaleTimeString()}.
          </p>
        </div>
      )}
    </AdminPage>
  );
}
