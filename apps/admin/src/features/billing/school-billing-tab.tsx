/** Billing for one school arrives with plan 3, which replaces this file (seam S2). */
export function SchoolBillingTab(props: { orgId: string; code: string }) {
  return (
    <p className='text-sm text-muted-foreground' data-school={props.code}>
      Payments arrive with billing.
    </p>
  );
}
