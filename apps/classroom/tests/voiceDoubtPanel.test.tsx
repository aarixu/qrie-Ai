import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  VoiceDoubtPanel,
  type VoiceDoubtPanelProps,
  type VoiceDoubtState,
  type VoiceTranscriptLine,
} from '../src/ui/VoiceDoubtPanel';
import { Waveform } from '../src/ui/Waveform';

const noop = (): void => {};

const render = (props: Partial<VoiceDoubtPanelProps> = {}): string =>
  renderToString(
    <VoiceDoubtPanel
      state="listening"
      transcript={[]}
      micLevel={0}
      muted={false}
      onToggleMute={noop}
      onEnd={noop}
      {...props}
    />,
  );

const line = (
  role: VoiceTranscriptLine['role'],
  text: string,
  final = true,
): VoiceTranscriptLine => ({ role, text, final });

/** The bar class only lands on the elements; the stylesheet always names it. */
const TUTOR_BAR = 'class="waveform-bar waveform-bar--tutor"';

describe('VoiceDoubtPanel: status line', () => {
  const expected: Record<VoiceDoubtState, string> = {
    connecting: 'Connecting…',
    listening: 'Listening — just speak your doubt',
    speaking: 'Tutor is answering…',
    error: 'Sorry, that connection dropped.',
  };

  for (const [state, text] of Object.entries(expected)) {
    it(`says "${text}" while ${state}`, () => {
      const html = render({ state: state as VoiceDoubtState });
      expect(html).toContain(text);
      // Only one status at a time — no leftovers from another state.
      for (const other of Object.values(expected)) {
        if (other !== text) expect(html).not.toContain(other);
      }
    });
  }

  it('offers Got it as the way out of an error, and disables the mic there', () => {
    const html = render({ state: 'error' });
    expect(html).toContain('Got it');
    expect(html).toContain('head back to the class');
    // The mic button is the only disabled control; muting a dead session is noise.
    expect(html).toContain('disabled=""');
  });

  it('keeps the mic live in every working state', () => {
    for (const state of ['connecting', 'listening', 'speaking'] as const) {
      expect(render({ state })).not.toContain('disabled=""');
    }
  });
});

describe('VoiceDoubtPanel: transcript', () => {
  const both = [line('student', 'Why does blood come back to the heart?'), line('tutor', 'Because the valves only open one way.')];

  it('renders both voices, newest last', () => {
    const html = render({ transcript: both });
    expect(html).toContain('Why does blood come back to the heart?');
    expect(html).toContain('Because the valves only open one way.');
    expect(html.indexOf('Why does blood')).toBeLessThan(html.indexOf('Because the valves'));
  });

  it('tells the two voices apart by side and colour', () => {
    const html = render({ transcript: both });
    expect(html).toContain('data-role="student"');
    expect(html).toContain('data-role="tutor"');
    expect(html).toContain('justify-self:end'); // student
    expect(html).toContain('justify-self:start'); // tutor
    // The tutor bubble is tinted with the theme blue; the student bubble is not.
    expect(html).toContain('#1cb0f614');
  });

  it('renders a line still being spoken differently from a settled one', () => {
    const speaking = render({ transcript: [line('tutor', 'One moment', false)] });
    const settled = render({ transcript: [line('tutor', 'One moment', true)] });
    expect(speaking).not.toBe(settled);
    expect(speaking).toContain('font-style:italic');
    expect(speaking).toContain('opacity:0.55');
    expect(settled).not.toContain('font-style:italic');
  });

  it('renders no scroller at all before the first line', () => {
    expect(render()).not.toContain('overflow-y:auto');
    expect(render({ transcript: [line('tutor', 'Hi')] })).toContain('overflow-y:auto');
  });
});

describe('VoiceDoubtPanel: typing fallback', () => {
  it('has no text input when onSendText is not given', () => {
    const html = render();
    expect(html).not.toContain('<input');
    expect(html).not.toContain('Type instead');
  });

  it('offers the collapsed input when onSendText is given', () => {
    const html = render({ onSendText: noop });
    expect(html).toContain('Type instead');
    expect(html).toContain('aria-label="type your doubt"');
    // Collapsed by default: <details> without `open`. Voice is the default path.
    expect(html).toContain('<details');
    expect(html).not.toContain('open=""');
  });
});

describe('VoiceDoubtPanel: icon-only buttons carry labels', () => {
  it('labels the mic toggle with the action it performs', () => {
    expect(render()).toContain('aria-label="mute microphone"');
    expect(render({ muted: true })).toContain('aria-label="unmute microphone"');
  });

  it('reports mute state to assistive tech', () => {
    expect(render({ muted: true })).toContain('aria-pressed="true"');
    expect(render({ muted: false })).toContain('aria-pressed="false"');
  });

  it('labels the send button', () => {
    expect(render({ onSendText: noop })).toContain('aria-label="send doubt"');
  });
});

describe('VoiceDoubtPanel: waveform wiring', () => {
  it('follows the mic while the student talks', () => {
    const quiet = render({ micLevel: 0 });
    const loud = render({ micLevel: 1 });
    expect(loud).not.toBe(quiet);
    expect(loud).toContain('scaleY(1.000)');
  });

  it('flattens the bars when muted, whatever the mic reports', () => {
    const html = render({ muted: true, micLevel: 1 });
    expect(html).not.toContain('scaleY(1.000)');
    expect(html).toContain('scaleY(0.140)');
  });

  it('switches to the tutor visual while she is answering', () => {
    expect(render({ state: 'speaking' })).toContain(TUTOR_BAR);
    expect(render({ state: 'listening' })).not.toContain(TUTOR_BAR);
  });
});

describe('Waveform', () => {
  // Drop the component stylesheet first: its keyframes mention scaleY too, and
  // only the inline transforms are the bars we are measuring.
  const bars = (html: string): string[] =>
    html.replace(/<style>[\s\S]*?<\/style>/, '').match(/scaleY\([\d.]+\)/g) ?? [];

  it('draws seven bars, centre-weighted', () => {
    const heights = bars(renderToString(<Waveform level={1} source="mic" />)).map((s) =>
      Number(s.slice(7, -1)),
    );
    expect(heights).toHaveLength(7);
    expect(heights[3]).toBe(1);
    expect(heights[0]).toBeLessThan(heights[3]);
    expect(heights[0]).toBe(heights[6]);
  });

  it('never collapses to nothing at zero level', () => {
    for (const h of bars(renderToString(<Waveform level={0} source="mic" />))) {
      expect(h).toBe('scaleY(0.140)');
    }
  });

  it('clamps levels outside 0..1', () => {
    expect(renderToString(<Waveform level={5} source="mic" />)).toBe(
      renderToString(<Waveform level={1} source="mic" />),
    );
    expect(renderToString(<Waveform level={-2} source="mic" />)).toBe(
      renderToString(<Waveform level={0} source="mic" />),
    );
  });

  it('hands the tutor bars to the keyframes instead of an inline transform', () => {
    const html = renderToString(<Waveform level={1} source="tutor" />);
    expect(bars(html)).toHaveLength(0);
    expect(html).toContain('animation-delay');
    // A different colour from the mic green, so the two never read as the same thing.
    expect(html).toContain('#1cb0f6');
    expect(html).not.toContain('#58cc02');
  });

  it('stands still under prefers-reduced-motion', () => {
    const html = renderToString(<Waveform level={0.5} source="tutor" />);
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
    expect(html).toContain('animation: none');
  });

  it('is decorative — the status line carries the meaning', () => {
    expect(renderToString(<Waveform level={0.5} source="mic" />)).toContain('aria-hidden="true"');
  });
});
