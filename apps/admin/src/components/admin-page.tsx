import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useSearch } from '@/context/search-provider';
import { useMe } from '@/lib/me';
import { showsHeaderStop } from '@/lib/nav';
import { EXPECTED_ENV } from '@/lib/supabase';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HeaderStop } from '@/components/header-stop';
import { Header } from '@/components/layout/header';
import { Main } from '@/components/layout/main';
import { ThemeSwitch } from '@/components/theme-switch';

/**
 * Every page's frame: the environment on every screen (red when it is the live
 * one), search, theme, and a red warning across the page when this build was
 * made for a different database than the one it is talking to. Finance, who
 * can open neither Today nor System, gets the stop button here (lib/nav.ts).
 */
export function AdminPage({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const me = useMe();
  const { setOpen } = useSearch();
  const mismatch = EXPECTED_ENV !== me.environment;
  return (
    <>
      <Header fixed>
        <Badge variant={me.environment === 'HOSTED' ? 'destructive' : 'secondary'}>{me.environment}</Badge>
        <div className='ms-auto flex items-center gap-2'>
          {showsHeaderStop(me.role) && <HeaderStop />}
          <Button variant='outline' size='sm' onClick={() => setOpen(true)} className='text-muted-foreground'>
            <Search /> Search <kbd className='ms-2 text-xs'>Ctrl K</kbd>
          </Button>
          <ThemeSwitch />
        </div>
      </Header>
      <Main>
        {mismatch && (
          <Alert variant='destructive' className='mb-4'>
            <AlertTitle>Wrong database for this build</AlertTitle>
            <AlertDescription>
              This build is for “{EXPECTED_ENV || 'nothing'}” but the database says {me.environment}. Do not make changes.
            </AlertDescription>
          </Alert>
        )}
        <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
          <h1 className='text-2xl font-bold tracking-tight'>{title}</h1>
          {actions}
        </div>
        {children}
      </Main>
    </>
  );
}
