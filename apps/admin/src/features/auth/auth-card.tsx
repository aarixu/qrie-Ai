import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** The frame of the screens before the gate: one centred card, the console's name above it. */
export function AuthCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <main className='flex min-h-svh items-center justify-center bg-muted/40 p-4'>
      <div className='w-full max-w-sm space-y-4'>
        <div className='flex items-center justify-center gap-2 font-semibold'>
          <ShieldCheck className='size-5' /> Qrie control
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
