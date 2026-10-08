import type { CSSProperties, ReactElement } from 'react';
import type { Credit, Lesson } from '@ai-tutor/lesson-format';

/**
 * EVERY PICTURE FROM THE WEB, LISTED WITH ITS LINKS (review, 2026-10-08).
 *
 * The credit written on a picture's foot names its author and licence and has
 * no room for more. CC BY and CC BY-SA also ask for a link to the licence where
 * that is reasonably practicable, and a link to the work is the courteous
 * part: so a class lists every found picture once, under its board — who made
 * it, its licence as a link to its terms, and a link to where it came from.
 */

/** Each found picture's credit once, in the order the board holds them. */
export function creditsOf(lesson: Lesson): Credit[] {
  const seen = new Set<string>();
  const out: Credit[] = [];
  for (const el of lesson.elements) {
    if ((el.kind !== 'image' && el.kind !== 'graphic') || !el.credit) continue;
    const key = JSON.stringify([el.credit.page, el.credit.author, el.credit.license]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(el.credit);
  }
  return out;
}

/** Only a web page is ever a link: a saved class is data from a store. */
const isWebPage = (link: string | undefined): link is string => typeof link === 'string' && /^https:\/\/[^\s"'<>]+$/.test(link);

const LINK = { color: 'inherit', textDecoration: 'underline' } as const;

/** The list, or nothing for a class with no picture from the web. */
export function CreditsList({ lesson, style }: { lesson: Lesson; style?: CSSProperties }): ReactElement | null {
  const credits = creditsOf(lesson);
  if (credits.length === 0) return null;
  return (
    <section aria-label="Picture credits" style={{ fontSize: 12, lineHeight: 1.5, color: '#5b6672', ...style }}>
      <strong style={{ fontWeight: 600 }}>Picture credits</strong>
      <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
        {credits.map((c, n) => (
          <li key={n}>
            {c.author ? `${c.author}, ` : ''}
            {isWebPage(c.licenseUrl) ? (
              <a href={c.licenseUrl} target="_blank" rel="noopener noreferrer" style={LINK}>
                {c.license}
              </a>
            ) : (
              c.license
            )}
            {isWebPage(c.page) && (
              <>
                {', '}
                <a href={c.page} target="_blank" rel="noopener noreferrer" style={LINK}>
                  source
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
