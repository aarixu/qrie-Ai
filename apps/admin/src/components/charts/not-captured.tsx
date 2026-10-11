import { CircleSlash } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NOT_CAPTURED_TEXT } from '@/features/charts/model';

/**
 * A figure this database cannot see: its label, "Not captured" in grey, and
 * the reason the database gives. Never a zero.
 */
export function NotCaptured({ label, why, className }: { label: string; why: string | null; className?: string }) {
  return (
    <Card className={className ? `bg-muted/40 ${className}` : 'bg-muted/40'}>
      <CardHeader>
        <CardTitle className='text-muted-foreground'>{label}</CardTitle>
        <CardDescription className='flex items-center gap-1.5'>
          <CircleSlash className='size-4' aria-hidden />
          {NOT_CAPTURED_TEXT}
        </CardDescription>
      </CardHeader>
      {why && (
        <CardContent>
          <p className='text-sm text-muted-foreground'>{why}</p>
        </CardContent>
      )}
    </Card>
  );
}
