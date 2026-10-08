import { useParams } from '@tanstack/react-router';
import { billing } from '@/lib/client';
import { AdminPage } from '@/components/admin-page';
import { ReadState } from './parts.tsx';
import { SchoolBillingView } from './school-billing-tab.tsx';
import { useLoad } from './use-load.ts';

/** /billing/schools/$orgId: one school's billing, framed with its name. */
export function SchoolBillingPage() {
  const { orgId } = useParams({ from: '/billing/schools/$orgId' });
  const page = useLoad(() => billing.school(orgId), orgId);
  const d = page.data;
  return (
    <AdminPage title={d ? `${d.school.name} (${d.school.code})` : 'School billing'}>
      <ReadState loading={page.loading} refused={page.refused} error={page.error} hasData={d !== null} onRetry={() => void page.reload()} />
      {d && !page.refused && <SchoolBillingView data={d} code={d.school.code} onChanged={() => void page.reload()} />}
    </AdminPage>
  );
}
