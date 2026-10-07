import type { BillingPlan } from '@ai-tutor/admin-client';
import { useState } from 'react';
import { toast } from 'sonner';
import { billing } from '@/lib/client';
import { useMe } from '@/lib/me';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AdminPage } from '@/components/admin-page';
import { billingRights } from './model.ts';
import { formatPaise, parseRupees } from './money.ts';
import { Empty, ReadState } from './parts.tsx';
import { useLoad } from './use-load.ts';
import { WriteDialog } from './write-dialog.tsx';

/** The plans on sale and their price per seat. The owner sets them, with a fresh code. */
export function PlansPage() {
  const rights = billingRights(useMe().role);
  const [editing, setEditing] = useState<BillingPlan | 'new' | null>(null);
  const list = useLoad(() => billing.plans());
  return (
    <AdminPage title='Plans' actions={rights.settings && <Button onClick={() => setEditing('new')}>New plan</Button>}>
      <ReadState loading={list.loading} refused={list.refused} error={list.error} hasData={list.data !== null} onRetry={() => void list.reload()} />
      {list.data && !list.refused && (
        <Card className='py-0'>
          <CardContent className='px-0'>
            {list.data.length === 0 ? (
              <div className='px-4'>
                <Empty>No plans yet. The owner enters the prices.</Empty>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className='text-end'>Months</TableHead>
                    <TableHead className='text-end'>Price per seat</TableHead>
                    <TableHead>On sale</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.map((p) => (
                    <TableRow key={p.code}>
                      <TableCell className='font-mono text-xs'>{p.code}</TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className='text-end tabular-nums'>{p.months}</TableCell>
                      <TableCell className='text-end tabular-nums'>{formatPaise(p.seatPricePaise)}</TableCell>
                      <TableCell>{p.active ? 'Yes' : 'No'}</TableCell>
                      <TableCell className='text-end'>
                        {rights.settings && (
                          <Button size='sm' variant='outline' onClick={() => setEditing(p)}>
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
      {editing && (
        <PlanDialog
          plan={editing === 'new' ? null : editing}
          onClose={() => {
            setEditing(null);
            void list.reload();
          }}
        />
      )}
    </AdminPage>
  );
}

function PlanDialog({ plan, onClose }: { plan: BillingPlan | null; onClose: () => void }) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [months, setMonths] = useState(String(plan?.months ?? 12));
  const [price, setPrice] = useState(plan ? String(plan.seatPricePaise / 100) : '');
  const [active, setActive] = useState(plan?.active ?? true);
  const parsed = parseRupees(price);
  const blast = parsed.ok
    ? `${code || 'This plan'}: ${formatPaise(parsed.paise)} a seat for ${months} months${active ? '' : ', not on sale'}. Subscriptions already sold keep the price they were sold at.`
    : 'Enter the price per seat in rupees.';
  return (
    <WriteDialog
      title={plan ? `Edit ${plan.code}` : 'New plan'}
      blast={blast}
      guarded
      confirmLabel='Save the plan'
      onClose={onClose}
      onConfirm={async ({ env, reason }) => {
        if (!parsed.ok) throw new Error(parsed.error);
        await billing.planSet({ code, name, months: Number(months), seatPricePaise: parsed.paise, active, reason, env });
        toast.success(`${code} saved.`);
      }}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        <div className='space-y-1'>
          <Label htmlFor='plan-code'>Code</Label>
          <Input id='plan-code' value={code} disabled={plan !== null} onChange={(e) => setCode(e.target.value)} placeholder='standard' />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='plan-name'>Name</Label>
          <Input id='plan-name' value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='plan-months'>Months</Label>
          <Input id='plan-months' inputMode='numeric' value={months} onChange={(e) => setMonths(e.target.value)} />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='plan-price'>Price per seat, in rupees</Label>
          <Input id='plan-price' inputMode='decimal' value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className='flex items-center gap-2'>
          <Switch id='plan-active' checked={active} onCheckedChange={setActive} />
          <Label htmlFor='plan-active'>On sale</Label>
        </div>
      </div>
    </WriteDialog>
  );
}
