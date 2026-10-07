import { blastExport } from '@/lib/blast';
import { schools } from '@/lib/client';
import { csvName, downloadCsv, toCsv } from '@/lib/csv';
import { istToday } from '@/lib/time';
import { WriteDialog } from '@/components/write-dialog';

/**
 * The school's register as three CSV files saved to this computer: people,
 * parents (by ID, with their children's IDs) and work (with hand-in counts).
 * admin.school_export; the owner, with a fresh code. No PIN, answer, mark or
 * parent's name is in it.
 */
export function ExportSchool({ code, open, onOpenChange }: { code: string; open: boolean; onOpenChange(open: boolean): void }) {
  return (
    <WriteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Export ${code}`}
      blast={blastExport(code)}
      guarded
      confirmLabel='Save the files'
      onConfirm={async (w) => {
        const x = await schools.exportSchool({ code, ...w });
        const day = istToday();
        downloadCsv(
          csvName(`${code}-people`, w.env, day),
          toCsv(
            ['Login ID', 'Kind', 'Name', 'Class', 'Roll', 'Left on'],
            x.people.map((p) => [p.loginId, p.kind, p.displayName, p.className, p.roll, p.leftOn]),
          ),
        );
        downloadCsv(
          csvName(`${code}-parents`, w.env, day),
          toCsv(['Login ID', "Children's login IDs"], x.parents.map((p) => [p.loginId, p.children.join(' ')])),
        );
        downloadCsv(
          csvName(`${code}-work`, w.env, day),
          toCsv(
            ['Title', 'Kind', 'Class', 'Subject', 'Published', 'Due', 'Handed in'],
            x.work.map((t) => [t.title, t.kind, t.className, t.subject, t.publishedOn, t.dueOn, t.handedIn]),
          ),
        );
      }}
    />
  );
}
