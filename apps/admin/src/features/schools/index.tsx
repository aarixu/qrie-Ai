import type { Level, SchoolRow } from '@ai-tutor/admin-client';
import { useNavigate } from '@tanstack/react-router';
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type FilterFn,
  type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { schools } from '@/lib/client';
import { bySeverity, LEVEL_RANK } from '@/lib/health';
import { useMe } from '@/lib/me';
import { canOperate } from '@/lib/roles';
import { filterSchools } from '@/lib/school-filters';
import { useLoad } from '@/lib/use-load';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AdminPage } from '@/components/admin-page';
import { DataTableColumnHeader, DataTablePagination, DataTableToolbar } from '@/components/data-table';
import { LoadView } from '@/components/load-view';
import { CreateSchool } from './actions/create-school';
import { LevelBadge } from './health-card';

const LEVEL_OPTIONS: { label: string; value: Level }[] = [
  { label: 'Red', value: 'red' },
  { label: 'Amber', value: 'amber' },
  { label: 'Grey', value: 'grey' },
  { label: 'Green', value: 'green' },
];

/** A school row passes when its code starts with, or its name contains, what was typed (lib/school-filters). */
const textFilter: FilterFn<SchoolRow> = (row, _id, value) =>
  filterSchools([row.original], { text: String(value ?? ''), health: [], payment: [], offboarded: 'show' }).length > 0;

const oneOf: FilterFn<SchoolRow> = (row, id, value) => !Array.isArray(value) || value.length === 0 || value.includes(row.getValue(id));

const byLevel = (a: Level, b: Level) => LEVEL_RANK[a] - LEVEL_RANK[b];

const columns: ColumnDef<SchoolRow>[] = [
  {
    id: 'school',
    accessorFn: (r) => r.name,
    header: ({ column }) => <DataTableColumnHeader column={column} title='School' />,
    cell: ({ row }) => (
      <div className='min-w-40'>
        <div className='font-medium'>{row.original.name}</div>
        <div className='flex items-center gap-2 font-mono text-xs text-muted-foreground'>
          {row.original.code}
          {row.original.offboarded && (
            <Badge variant='secondary' className='font-sans'>
              Offboarded
            </Badge>
          )}
        </div>
      </div>
    ),
  },
  {
    id: 'plan',
    accessorFn: (r) => r.plan ?? '',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Plan' />,
    cell: ({ row }) => row.original.plan ?? <span className='text-muted-foreground'>None</span>,
  },
  {
    id: 'seats',
    accessorFn: (r) => r.seatsUsed,
    header: ({ column }) => <DataTableColumnHeader column={column} title='Seats' />,
    cell: ({ row }) =>
      row.original.seats === null ? (
        <span className='text-muted-foreground'>No licence</span>
      ) : (
        `${row.original.seatsUsed} of ${row.original.seats}`
      ),
  },
  {
    id: 'licence',
    accessorFn: (r) => r.daysLeft ?? Number.POSITIVE_INFINITY,
    header: ({ column }) => <DataTableColumnHeader column={column} title='Licence ends' />,
    cell: ({ row }) =>
      row.original.validUntil === null ? (
        <span className='text-muted-foreground'>None</span>
      ) : (
        <div>
          <div>{row.original.validUntil}</div>
          <div className={cn('text-xs', (row.original.daysLeft ?? 0) <= 7 ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground')}>
            {(row.original.daysLeft ?? 0) < 0 ? 'ended' : `${row.original.daysLeft} days`}
          </div>
        </div>
      ),
  },
  {
    id: 'payment',
    accessorFn: (r) => r.paymentLevel,
    filterFn: oneOf,
    sortingFn: (a, b) => byLevel(a.original.paymentLevel, b.original.paymentLevel),
    header: ({ column }) => <DataTableColumnHeader column={column} title='Payment' />,
    cell: ({ row }) => (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <LevelBadge level={row.original.paymentLevel}>{row.original.paymentLevel}</LevelBadge>
          </span>
        </TooltipTrigger>
        <TooltipContent>{row.original.paymentReason}</TooltipContent>
      </Tooltip>
    ),
  },
  {
    id: 'health',
    accessorFn: (r) => r.healthLevel,
    filterFn: oneOf,
    sortingFn: (a, b) => byLevel(a.original.healthLevel, b.original.healthLevel),
    header: ({ column }) => <DataTableColumnHeader column={column} title='Health' />,
    cell: ({ row }) => (
      <div className='max-w-72'>
        <LevelBadge level={row.original.healthLevel}>{row.original.healthLabel}</LevelBadge>
      </div>
    ),
  },
  {
    id: 'lastActive',
    accessorFn: (r) => r.lastActive ?? '',
    header: ({ column }) => <DataTableColumnHeader column={column} title='Last active' />,
    cell: ({ row }) => row.original.lastActive ?? <span className='text-muted-foreground'>Never</span>,
  },
  {
    id: 'students',
    accessorFn: (r) => r.students,
    header: ({ column }) => <DataTableColumnHeader column={column} title='Students' />,
  },
  {
    id: 'teachers',
    accessorFn: (r) => r.teachers,
    header: ({ column }) => <DataTableColumnHeader column={column} title='Teachers' />,
  },
  {
    id: 'offboarded',
    accessorFn: (r) => (r.offboarded ? 'yes' : 'no'),
    filterFn: oneOf,
    enableHiding: false,
  },
];

/** Every school in one list, the worst health first. Counts only: no child is named here. */
export function Schools() {
  const me = useMe();
  const navigate = useNavigate();
  const { view, reload } = useLoad(() => schools.list(), []);
  const [creating, setCreating] = useState(false);
  const mayCreate = canOperate(me.role);

  return (
    <AdminPage title='Schools' actions={mayCreate && <Button onClick={() => setCreating(true)}>Create a school</Button>}>
      <LoadView view={view} reload={reload}>
        {(rows) =>
          rows.length === 0 ? (
            <Card>
              <CardContent className='flex flex-wrap items-center gap-3'>
                <p className='text-sm text-muted-foreground'>No schools yet.</p>
                {mayCreate && (
                  <Button variant='outline' size='sm' onClick={() => setCreating(true)}>
                    Create a school
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <SchoolTable rows={rows} onOpen={(code) => void navigate({ to: '/schools/$code', params: { code }, search: { tab: 'overview' } })} />
          )
        }
      </LoadView>
      <CreateSchool
        open={creating}
        onOpenChange={setCreating}
        onCreated={(code) => void navigate({ to: '/schools/$code', params: { code }, search: { tab: 'overview' } })}
      />
    </AdminPage>
  );
}

function SchoolTable({ rows, onOpen }: { rows: SchoolRow[]; onOpen(code: string): void }) {
  // The default order is the worst health first; a column header sorts otherwise.
  const data = useMemo(() => [...rows].sort(bySeverity), [rows]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: textFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    initialState: { pagination: { pageSize: 25 }, columnVisibility: { offboarded: false } },
  });

  return (
    <div className='space-y-4'>
      <DataTableToolbar
        table={table}
        searchPlaceholder='Code or name…'
        filters={[
          { columnId: 'health', title: 'Health', options: LEVEL_OPTIONS },
          { columnId: 'payment', title: 'Payment', options: LEVEL_OPTIONS },
          {
            columnId: 'offboarded',
            title: 'Offboarded',
            options: [
              { label: 'Offboarded', value: 'yes' },
              { label: 'Not offboarded', value: 'no' },
            ],
          },
        ]}
      />
      <Card className='py-0'>
        <CardContent className='px-0'>
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead key={h.id}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className='text-center text-sm text-muted-foreground'>
                    No school matches.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className='cursor-pointer' onClick={() => onOpen(row.original.code)}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className='align-top'>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <DataTablePagination table={table} />
    </div>
  );
}
