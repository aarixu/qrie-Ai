import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

/**
 * The School Portal is the admin's. A teacher who opens one of its addresses
 * is taken to their own home; the database refuses them its data anyway.
 */
export const Route = createFileRoute('/_authenticated/school')({
  beforeLoad: ({ context }) => {
    if (context.me.kind !== 'admin') throw redirect({ to: '/', replace: true })
  },
  component: Outlet,
})
