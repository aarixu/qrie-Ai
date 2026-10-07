# Qrie — the student app

A school's students sign in with the ID and PIN on their slip, see their
homework, answer it, hand in photos of notebook work, and see their marks.
One app for every school: the school's name and colour come from its
record (`lms.school.brand`) once a student signs in.

Run it against the demo school:

```bash
npm run demo
```

```bash
npm run student
```

Then open http://localhost:5181. Student IDs and PINs are in
`tools/lms-demo/.demo-data/logins.md`.

The UI components in `src/components/ui` are copied from
[satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) (MIT,
copyright (c) 2024 Sat Naing — see `LICENSE`), as the teacher app's are.
