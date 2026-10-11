# Qrie control — the staff console

The platform's own console: staff only, on its own address. Design:
`docs/superpowers/specs/2026-10-06-super-admin-panel-design.md`. Setup and running it:
`docs/ops/admin-console.md`.

Its look and its UI kit are the teacher app's (`apps/lms`), which started from
[satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin), MIT licensed,
copyright (c) 2024 Sat Naing. That licence is kept in [LICENSE](LICENSE) and covers
the files that came from it: `src/components/ui/*`, `src/components/layout/{header,main,nav-group,types,authenticated-layout}.tsx`,
`src/context/{theme,layout,search}-provider.tsx`, `src/components/{theme-switch,skip-to-main,confirm-dialog}.tsx`,
`src/hooks/*`, `src/lib/{utils,cookies}.ts` and `src/styles/*`. They are copied, not
imported, so a change to the teacher app never changes this one.
