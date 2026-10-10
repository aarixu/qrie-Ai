import { APP_READERS } from '@/lib/app-readers';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';

/** Who reads which switch, when, and what each does when it cannot (lib/app-readers.ts). Reads nothing from the database. */
export function AppsPage() {
  return (
    <AdminPage title='Apps'>
      <p className='mb-4 text-sm text-muted-foreground'>
        What each app reads from these switches, and what it does when it cannot read them. An app obeys them only once a build
        that reads them is deployed (see the runbook, section 7).
      </p>
      <Card className='py-0'>
        <CardContent className='px-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Reads</TableHead>
                <TableHead>When</TableHead>
                <TableHead>If it cannot read</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {APP_READERS.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className='align-top text-sm whitespace-normal'>
                    {r.name}
                    {r.note && <div className='text-xs text-muted-foreground'>{r.note}</div>}
                  </TableCell>
                  <TableCell className='align-top whitespace-normal'>
                    <ul className='space-y-0.5'>
                      {r.reads.map((k) => (
                        <li key={k} className='font-mono text-xs'>
                          {k}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell className='align-top text-sm whitespace-normal'>{r.when}</TableCell>
                  <TableCell className='align-top text-sm whitespace-normal'>{r.ifUnread}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}
