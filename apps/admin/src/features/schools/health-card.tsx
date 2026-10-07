import type { Health, Level } from '@ai-tutor/admin-client';
import type { ReactNode } from 'react';
import { LEVEL_TONE, SIGNAL_TITLE } from '@/lib/health';
import type { Tone } from '@/lib/tiles';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const DOT: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-600',
  grey: 'bg-muted-foreground/40',
};

const TEXT: Record<Tone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-red-700 dark:text-red-400',
  grey: 'text-muted-foreground',
};

export function LevelDot({ level, className }: { level: Level; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', DOT[LEVEL_TONE[level]], className)} />;
}

/** A level as a badge: its dot and its words, in its colour; grey reads as grey, never as fine. */
export function LevelBadge({ level, children }: { level: Level; children: ReactNode }) {
  return (
    <Badge variant='outline' className={cn('max-w-full gap-1.5 whitespace-normal text-start font-normal', TEXT[LEVEL_TONE[level]])}>
      <LevelDot level={level} />
      <span>{children}</span>
    </Badge>
  );
}

/** The nine signals of a school, the label at the top. Counts only: no child is named. */
export function HealthCard({ health }: { health: Health }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Health</CardDescription>
        <CardTitle className={cn('text-lg', TEXT[LEVEL_TONE[health.level]])}>{health.label}</CardTitle>
        {health.quietUntil && <p className='text-sm text-muted-foreground'>On holiday until {health.quietUntil}.</p>}
      </CardHeader>
      <CardContent>
        <ul className='divide-y'>
          {health.signals.map((s) => (
            <li key={s.key} className='flex items-start gap-3 py-2 text-sm'>
              <LevelDot level={s.level} className='mt-1.5' />
              <span className='w-28 shrink-0 font-medium'>{SIGNAL_TITLE[s.key]}</span>
              <span className={cn(s.level === 'grey' && 'text-muted-foreground')}>{s.reason}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
