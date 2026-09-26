import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { SOURCE_PROBLEM, type SourceProblem, type SourcePage } from '../lib/sourceText';
import { freshSourceKey, holdSource } from '../lib/sourceHandoff';
import { track } from '../lib/telemetry';
import { PROTOTYPE_ONLY_PREPARED, usePrototypeNotice } from '../lib/prototype';
import { PrototypeNotice } from './PrototypeNotice';

/**
 * THE THIRD DOOR INTO A CLASS: ASK FOR ANYTHING, OR HAND OVER A PAGE.
 *
 * The syllabus is what a student is MEANT to study; this is what they actually
 * wondered about at nine at night, and what their teacher sent them on
 * WhatsApp. Both go to the same room by the same road — only without a
 * topicRef, which is why a class from here is taught and not kept: there is
 * nothing a later student could ask for it by.
 *
 * It lives in ui/ rather than inside Home because Home is a layout file and
 * this is now a small machine — a file picker, four states and six ways to
 * fail — and the day the library screen wants the same door it should get this
 * one rather than a second one that drifts.
 *
 * THE FILE IS READ HERE, NOT IN THE CLASSROOM. Every failure below is
 * something a real file does — it is a scan, it is locked, it is a photograph,
 * it is 200 MB — and all of them have to happen while the student is still
 * looking at the box they chose the file with. Reading it after navigating
 * would put each one on a black stage that promised them a class, which is the
 * definition of leaving somebody staring at a spinner.
 */

/** What the box is doing. `page` is a file read and waiting to be taught. */
type Holding =
  | { state: 'idle' }
  | { state: 'reading'; name: string }
  | { state: 'held'; page: SourcePage; key: string }
  | { state: 'refused'; problem: SourceProblem };

export function AskBox() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [holding, setHolding] = useState<Holding>({ state: 'idle' });
  const picker = useRef<HTMLInputElement>(null);
  const notice = usePrototypeNotice();

  /**
   * THE WHOLE BOX IS FROZEN, not one control of it.
   *
   * Both doors here are ALWAYS cold: a typed topic and an uploaded page carry
   * no topicRef, so neither can ever match a class that already exists — the
   * docblock above says so ("taught and not kept"). There is no warm case to
   * preserve, which is what makes this the one control that freezes whole.
   *
   * The paperclip is frozen at the paperclip and not at "Teach this". By the
   * time "Teach this" renders, the student has chosen a file, watched it being
   * read and been told how many words came out of it. Refusing them at the end
   * of that is the worst possible moment to refuse them.
   */
  const frozen = PROTOTYPE_ONLY_PREPARED;
  const explain = () => notice.show('Anything you ask for');

  const go = () => {
    const asked = topic.trim();
    if (asked) navigate(`/class?topic=${encodeURIComponent(asked)}`);
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setHolding({ state: 'reading', name: file.name });
    /**
     * Fetched when a student actually brings a file, not when Home renders.
     *
     * Home is eager, so a static import here put the reader and its inflate
     * into a chunk every student downloads on the first screen — for a feature
     * most of them will never touch. The pdf.js half was already lazy inside
     * the reader; this makes the other half match.
     */
    const { readSource } = await import('../lib/readSource');
    const result = await readSource(file);
    if (!result.ok) {
      // The KIND of failure, never the file. A name is student data and this
      // goes to the same telemetry as every screen view.
      track('source_refused', { problem: result.problem });
      setHolding({ state: 'refused', problem: result.problem });
      return;
    }
    const key = freshSourceKey();
    const page: SourcePage = {
      title: result.page.title,
      text: result.page.text,
      truncated: result.page.truncated,
    };
    holdSource(key, page);
    track('source_read', {
      kind: result.page.kind,
      chars: page.text.length,
      truncated: page.truncated ? 1 : 0,
    });
    setHolding({ state: 'held', page, key });
  };

  const clear = () => setHolding({ state: 'idle' });

  /**
   * Open the picker, having first forgotten what it is holding.
   *
   * An <input type="file"> fires nothing when the same file is chosen twice,
   * so a student whose file came back "damaged" and who picked that very same
   * file again — which is exactly what somebody does when they suspect a bad
   * download — got no response at all from the app.
   */
  const pick = () => {
    if (!picker.current) return;
    picker.current.value = '';
    picker.current.click();
  };

  return (
    <div className="bg-surface-container-lowest rounded-[20px] p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full grid place-items-center shrink-0 bg-primary text-on-primary">
          <Icon name="auto_awesome" filled />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">
            Ask Meera
          </div>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (frozen ? explain() : go())}
            // readOnly rather than disabled: a disabled input takes no click,
            // so tapping it would do nothing at all and the student would be
            // left guessing. This one still answers — with the notice.
            readOnly={frozen}
            onClick={frozen ? explain : undefined}
            placeholder={frozen ? 'Ask anything — coming soon' : 'What should she teach you?'}
            aria-label="What should she teach you?"
            aria-disabled={frozen}
            className={`w-full bg-transparent outline-none font-headline-md text-[17px] leading-6 text-on-surface placeholder:text-on-surface-variant ${
              frozen ? 'cursor-default' : ''
            }`}
          />
        </div>

        {/* The accept list is a HINT — Android's picker routinely ignores it,
            and a file arrives named whatever the last app to touch it decided.
            So it narrows the list a student scrolls and decides nothing: what
            the file IS is read off its first bytes in lib/sourceText. */}
        <input
          ref={picker}
          type="file"
          accept=".pdf,.docx,.txt,.md,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="hidden"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <button
          onClick={frozen ? explain : pick}
          disabled={!frozen && holding.state === 'reading'}
          aria-label="Teach me from a file"
          aria-disabled={frozen}
          className={`w-11 h-11 grid place-items-center rounded-full text-on-surface-variant transition-colors shrink-0 ${
            frozen ? 'opacity-40 cursor-default' : 'hover:bg-surface-container-high disabled:opacity-40'
          }`}
        >
          <Icon name="attach_file" />
        </button>
        <button
          onClick={frozen ? explain : go}
          // Not disabled while frozen, and not gated on an empty box either:
          // the tap has to reach `explain`, which is the only way the student
          // finds out why nothing is happening.
          disabled={!frozen && topic.trim() === ''}
          aria-label="Start this class"
          aria-disabled={frozen}
          className={`bg-primary text-on-primary rounded-full w-11 h-11 grid place-items-center shadow-md shrink-0 ${
            frozen ? 'opacity-40 cursor-default' : 'disabled:opacity-40 active:scale-95 transition-transform'
          }`}
        >
          <Icon name="arrow_forward" filled />
        </button>
      </div>

      {holding.state !== 'idle' && (
        <div className="mt-3 pt-3 border-t-2 border-surface-variant">
          {holding.state === 'reading' && <Reading name={holding.name} />}
          {holding.state === 'held' && (
            <Held
              page={holding.page}
              onTeach={() => navigate(`/class?source=${encodeURIComponent(holding.key)}`)}
              onDrop={clear}
            />
          )}
          {holding.state === 'refused' && (
            <Refused problem={holding.problem} onAnother={pick} onDrop={clear} />
          )}
        </div>
      )}
      {notice.tapped && <PrototypeNotice topic={notice.tapped} onClose={notice.dismiss} />}
    </div>
  );
}

/**
 * The file being opened, on this phone.
 *
 * Said out loud because it is the single most surprising thing about this
 * feature and the only moment it can honestly be said: a student who has been
 * told all year not to upload their work anywhere is entitled to know that
 * this one did not.
 */
function Reading({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-3" aria-busy>
      <div className="w-10 h-10 rounded-full bg-surface-container grid place-items-center shrink-0">
        <Icon name="hourglass_top" className="text-on-surface-variant" />
      </div>
      <div className="min-w-0">
        <div className="font-body-md text-body-md text-on-surface truncate">Reading {name}…</div>
        {/*
          TRUE OF THE READING, AND ONLY OF THE READING.

          This said "Nothing is being sent anywhere", which is true while the
          file is being opened — the text is pulled out in the browser and the
          file itself never leaves the device. It stops being true one step
          later: the text that comes out is what the class is built from, and
          building a class is a model call. A child told nothing is being sent,
          who then watches a class appear, was told something that was true
          about the wrong moment.

          So it says what it actually promises — the FILE stays — and the
          screen that follows is where the rest is said.
        */}
        <div className="font-label-sm text-label-sm text-on-surface-variant">
          Opening it here. The file itself stays on your phone.
        </div>
      </div>
    </div>
  );
}

function Held({
  page,
  onTeach,
  onDrop,
}: {
  page: SourcePage;
  onTeach: () => void;
  onDrop: () => void;
}) {
  // Words rather than characters, and the opening rather than the whole thing
  // when that is what was kept. A student is entitled to know a class is being
  // planned from the first pages before it is planned, not after.
  const words = page.text.split(/\s+/).filter(Boolean).length;
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full ring-tint-green ink-green grid place-items-center shrink-0">
        <Icon name="menu_book" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-headline-md text-[16px] leading-6 text-on-surface truncate">
          {page.title}
        </div>
        <div className="font-label-sm text-label-sm text-on-surface-variant">
          {page.truncated
            ? `She will teach the opening — about ${words} words of it.`
            : `${words} ${words === 1 ? 'word' : 'words'} read.`}
        </div>
      </div>
      <button
        onClick={onDrop}
        aria-label="Use a different file"
        className="w-9 h-9 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high shrink-0"
      >
        <Icon name="close" />
      </button>
      <button
        onClick={onTeach}
        className="bg-primary text-on-primary font-label-md text-label-md px-4 py-2.5 rounded-xl shadow-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all shrink-0"
      >
        Teach this
      </button>
    </div>
  );
}

/**
 * A file that will not become a class.
 *
 * Never an error dialog and never a console line: the sentence says what
 * happened and points at the two things that still work — another file, or the
 * box directly above, which is already on the screen and already empty.
 */
function Refused({
  problem,
  onAnother,
  onDrop,
}: {
  problem: SourceProblem;
  onAnother: () => void;
  onDrop: () => void;
}) {
  const said = SOURCE_PROBLEM[problem];
  return (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-full bg-surface-container grid place-items-center shrink-0">
        <Icon name="error" className="text-on-surface-variant" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-headline-md text-[16px] leading-6 text-on-surface">{said.title}</div>
        <p className="font-body-md text-body-md text-on-surface-variant mt-0.5">{said.body}</p>
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={onAnother}
            className="font-label-md text-label-md text-primary px-3 py-2 -ml-3 rounded-full hover:bg-surface-container-high transition-colors"
          >
            Choose another file
          </button>
          <button
            onClick={onDrop}
            className="font-label-md text-label-md text-on-surface-variant px-3 py-2 rounded-full hover:bg-surface-container-high transition-colors"
          >
            Never mind
          </button>
        </div>
      </div>
    </div>
  );
}
