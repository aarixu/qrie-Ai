import {
  buildDoubtBrief,
  type AgentAdapter,
  type AgentIO,
  type AgentSession,
  type DoubtContext,
} from '@ai-tutor/doubt-session';
import { TUTOR, type StudentContext } from '@ai-tutor/persona';
import { createOutcomeLookup } from './outcomeLookup';
import {
  MIC_SAMPLE_RATE,
  createAudioPlayer,
  createMicCapture,
  micLevelOf,
  int16ToBase64,
  type MicCapture,
} from '@ai-tutor/voice';

/**
 * The speech-to-speech live doubt tutor: Gemini Live over a WebSocket, behind
 * the very same AgentAdapter the text agent and the stub implement. The seam
 * (bridges, states, recall wiring) lives in @ai-tutor/doubt-session and does
 * not know this file exists.
 *
 * The student talks; the tutor talks back. There is no typing in the loop.
 *
 * Two rules shape everything below, in this order:
 *  1. The class must NEVER get stuck. Every failure path — refused mic, dead
 *     socket, setup that never completes — says one short friendly line through
 *     io.say and then io.done(), handing the room back to the recording.
 *  2. After stop(), no io calls. The stub proves this discipline in tests; the
 *     `stopped` flag enforces it here against frames still in flight.
 *
 * The tutor's VOICE is played by this module, not by io.say. io.say is the
 * app's TTS path: routing her speech through it would play every sentence
 * twice. It is used only for the text-only fallback lines above.
 */

/**
 * The live models, in the order they are tried.
 *
 * 3.1 leads: it answers faster and its transcription arrives whole rather than
 * a few characters at a time. 2.5 is the fallback because it is a different
 * generation of the service — when one is refusing connections or has dropped a
 * model id, the other has generally still been up.
 *
 * Both were verified on this key against real pushed speech. Neither is ever
 * asked to greet: the bridge line belongs to the handoff, not to the model
 * (see the setupComplete case below), which is also what keeps 3.1 usable —
 * every path that makes a model speak first is blocked on 3.1 somewhere.
 */
export const LIVE_MODELS = [
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-native-audio-latest',
] as const;

const LIVE_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/**
 * Her voice, from the one constant the recorded narration also reads. These two
 * are synthesised by different APIs minutes apart inside a single lesson; a
 * literal here rather than the persona is how the recording and the live tutor
 * quietly become two different teachers.
 */
const VOICE_NAME = TUTOR.speechVoiceName;

/** A socket that opens but never finishes setup is the worst case: silent. */
const SETUP_TIMEOUT_MS = 10_000;

/** Poll interval for "has her voice finished coming out of the speaker?". */
const DRAIN_POLL_MS = 120;

/** Never hold the room longer than this waiting for playback to drain. */
const DRAIN_MAX_MS = 15_000;

/** Backstop: if end_doubt fires and the turn never closes, leave anyway. */
const END_BACKSTOP_MS = 20_000;

export const RECALL_TOOL = 'recall_moment';
export const END_TOOL = 'end_doubt';

const CONNECT_FAIL_LINE =
  "Sorry, my voice isn't coming through right now. Let's carry on with the class — raise your hand again in a moment.";
const MIC_FAIL_LINE =
  "I can't hear your microphone. Let's continue the class — check the mic permission and try raising your hand again.";
const DROPPED_LINE =
  "Oh, we got cut off there. Let's carry on with the class — raise your hand again and we'll pick this up.";

// ---------------------------------------------------------------------------
// Public types (the UI builds against these names)
// ---------------------------------------------------------------------------

/** What the room is doing, for the avatar and the mic indicator. */
export type LiveState = 'connecting' | 'listening' | 'speaking' | 'error';

/**
 * One caption line.
 *
 * `text` is always the WHOLE line so far, never a delta — transcripts arrive
 * from the API a couple of words at a time, and a UI that had to accumulate
 * them itself would be re-implementing this file's bookkeeping. Render the
 * latest non-final line for a role in place; when `final` is true that line is
 * finished and the next one starts fresh.
 */
export interface TranscriptLine {
  role: 'student' | 'tutor';
  text: string;
  final: boolean;
}

export interface LiveAgentOptions {
  apiKey: string;
  /**
   * Who is in front of her. Forwarded to the persona exactly as measured — an
   * unknown signal must stay unknown rather than be defaulted, or she adapts to
   * a student who does not exist.
   */
  student: StudentContext;
  /** Tried in order. Defaults to LIVE_MODELS. */
  models?: readonly string[];
  /** Captions for both sides of the conversation. */
  onTranscript?: (line: TranscriptLine) => void;
  /** Room state for the avatar / mic indicator. */
  onState?: (s: LiveState) => void;
  /** 0..1 microphone energy, for the waveform. Display only. */
  onMicLevel?: (level: number) => void;
  /**
   * Polled per audio chunk. While it returns true the mic keeps running but
   * nothing is sent — muting by closing the mic would drop the session's
   * voice-activity detection and leave the next question unanswered.
   */
  isMuted?: () => boolean;
}

// ---------------------------------------------------------------------------
// Setup frame
// ---------------------------------------------------------------------------

interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: {
    type: 'OBJECT';
    properties: Record<string, { type: 'STRING'; description: string }>;
    required: string[];
  };
}

export interface SetupFrame {
  setup: {
    model: string;
    generationConfig: {
      responseModalities: ['AUDIO'];
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } };
      temperature: number;
    };
    systemInstruction: { parts: { text: string }[] };
    tools: [{ functionDeclarations: FunctionDeclaration[] }];
    inputAudioTranscription: Record<string, never>;
    outputAudioTranscription: Record<string, never>;
  };
}

/**
 * The briefing.
 *
 * Not a word of her character is written here any more. Three call sites used
 * to hand-write this prompt — the typed agent, this one, and the LiveKit worker
 * — and they had already drifted into three slightly different teachers. It all
 * comes from @ai-tutor/persona now, assembled by doubt-session, which also
 * enumerates the recall targets so the list she is offered and the set we
 * accept back cannot disagree.
 */
export function buildLiveSystemInstruction(ctx: DoubtContext, student: StudentContext): string {
  return buildDoubtBrief(ctx, student, {
      moment: 'opening',
      surface: 'voice',
      // She is told the outcome this beat is for, and what it rests on.
      outcomes: createOutcomeLookup(),
    });
}

/** The first frame on the socket. Nothing is sent before this is acknowledged. */
export function buildSetupFrame(
  ctx: DoubtContext,
  model: string,
  student: StudentContext,
): SetupFrame {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } },
        temperature: 0.8,
      },
      systemInstruction: { parts: [{ text: buildLiveSystemInstruction(ctx, student) }] },
      tools: [
        {
          functionDeclarations: [
            {
              name: RECALL_TOOL,
              description:
                'Bring an earlier moment of this class back onto the canvas so the student can see it while you explain.',
              parameters: {
                type: 'OBJECT',
                properties: {
                  beatId: {
                    type: 'STRING',
                    description: 'The id of the moment to show. Must be one of the ids listed in the system instruction.',
                  },
                },
                required: ['beatId'],
              },
            },
            {
              name: END_TOOL,
              description:
                'The student is satisfied and the doubt is resolved. Hands the room back to the recording.',
            },
          ],
        },
      ],
      // Both directions transcribed so the UI can caption the conversation.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Server message parsing
// ---------------------------------------------------------------------------

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LiveServerEvent =
  | { type: 'setupComplete' }
  | { type: 'audio'; data: string }
  | { type: 'transcript'; role: 'student' | 'tutor'; text: string }
  | { type: 'toolCall'; calls: LiveToolCall[] }
  | { type: 'interrupted' }
  | { type: 'turnComplete' };

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const asText = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * Normalise one wire frame into typed events.
 *
 * A LIST, not a single event, because one frame genuinely carries several: a
 * serverContent frame routinely holds a caption fragment, a slice of her voice
 * and turnComplete all at once. Returning only the first would silently drop
 * audio. Events come out in the order they must be acted on — `interrupted`
 * before any audio in the same frame, `turnComplete` last.
 *
 * Anything unrecognised (usageMetadata, sessionResumptionUpdate, malformed
 * JSON) yields an empty list rather than throwing: an unexpected frame must
 * never take down a live class.
 */
export function parseServerMessage(json: unknown): LiveServerEvent[] {
  let msg: Record<string, unknown> | null;
  if (typeof json === 'string') {
    try {
      msg = asRecord(JSON.parse(json));
    } catch {
      return [];
    }
  } else {
    msg = asRecord(json);
  }
  if (msg === null) return [];

  const out: LiveServerEvent[] = [];

  if ('setupComplete' in msg) out.push({ type: 'setupComplete' });

  const sc = asRecord(msg.serverContent);
  if (sc !== null) {
    if (sc.interrupted === true) out.push({ type: 'interrupted' });

    const student = asText(asRecord(sc.inputTranscription)?.text);
    if (student !== null) out.push({ type: 'transcript', role: 'student', text: student });

    const tutor = asText(asRecord(sc.outputTranscription)?.text);
    if (tutor !== null) out.push({ type: 'transcript', role: 'tutor', text: tutor });

    for (const part of asArray(asRecord(sc.modelTurn)?.parts)) {
      const data = asText(asRecord(asRecord(part)?.inlineData)?.data);
      if (data !== null) out.push({ type: 'audio', data });
    }

    if (sc.turnComplete === true) out.push({ type: 'turnComplete' });
  }

  const toolCall = asRecord(msg.toolCall);
  if (toolCall !== null) {
    const calls: LiveToolCall[] = [];
    for (const raw of asArray(toolCall.functionCalls)) {
      const call = asRecord(raw);
      const name = asText(call?.name);
      if (call === null || name === null) continue;
      calls.push({
        id: typeof call.id === 'string' ? call.id : '',
        name,
        args: asRecord(call.args) ?? {},
      });
    }
    if (calls.length > 0) out.push({ type: 'toolCall', calls });
  }

  return out;
}

/**
 * The beatId from a recall_moment call, or null if it names a moment the
 * student has not seen. A hallucinated id is dropped, never acted on: yanking
 * the canvas to a beat from later in the lesson would spoil it, and to a
 * nonexistent one would blank the board.
 */
export function pickRecallBeatId(
  args: Record<string, unknown>,
  validIds: ReadonlySet<string>,
): string | null {
  const id = args.beatId;
  return typeof id === 'string' && validIds.has(id) ? id : null;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export function createLiveAgent(opts: LiveAgentOptions): AgentAdapter {
  const models = opts.models ?? LIVE_MODELS;

  return {
    start(ctx: DoubtContext, io: AgentIO): AgentSession {
      let stopped = false;
      // Which model this attempt is using. Only ever advances before the first
      // frame comes back: once she is talking, a drop is a dropped call, not a
      // reason to start again with someone else.
      let modelIndex = 0;
      let handedBack = false;
      let ready = false;
      let endRequested = false;

      const validIds = new Set(ctx.recentBeats.map((b) => b.id));
      const player = createAudioPlayer();
      let mic: MicCapture | null = null;
      let ws: WebSocket | null = null;

      let setupTimer: ReturnType<typeof setTimeout> | null = null;
      let stateTimer: ReturnType<typeof setTimeout> | null = null;
      let drainTimer: ReturnType<typeof setTimeout> | null = null;
      let backstopTimer: ReturnType<typeof setTimeout> | null = null;

      // Captions are accumulated here so the UI receives whole lines.
      let studentLine = '';
      let studentFinal = true;
      let tutorLine = '';

      const clearTimer = (t: ReturnType<typeof setTimeout> | null): null => {
        if (t !== null) clearTimeout(t);
        return null;
      };

      const setState = (s: LiveState): void => {
        if (!stopped) opts.onState?.(s);
      };

      const emit = (role: 'student' | 'tutor', text: string, final: boolean): void => {
        if (!stopped && text.length > 0) opts.onTranscript?.({ role, text, final });
      };

      const send = (frame: unknown): void => {
        if (stopped || ws === null || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(frame));
      };

      const teardown = (): void => {
        setupTimer = clearTimer(setupTimer);
        stateTimer = clearTimer(stateTimer);
        drainTimer = clearTimer(drainTimer);
        backstopTimer = clearTimer(backstopTimer);
        mic?.stop();
        mic = null;
        player.close();
        if (ws !== null) {
          // Detach first: our own close must not re-enter the failure path.
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
          ws = null;
        }
      };

      /**
       * Rule 1: say one short line, then hand the room back. Never hold it.
       *
       * Unless there is another model left to try and this one never got as far
       * as saying anything — then the student hears nothing at all and we
       * quietly move down the list. A failover after she has already spoken
       * would restart the conversation from nothing, which is worse than the
       * apology.
       */
      const fail = (line: string): void => {
        if (stopped || handedBack) return;
        if (!ready && modelIndex + 1 < models.length) {
          modelIndex += 1;
          teardown();
          void connect().catch(() => fail(CONNECT_FAIL_LINE));
          return;
        }
        handedBack = true;
        setState('error');
        // Tear down before speaking so her half-finished voice cannot talk over
        // the apology, and the mic light goes out immediately.
        teardown();
        void io
          .say(line)
          .catch(() => undefined)
          .then(() => {
            if (!stopped) io.done();
          });
      };

      /** Hand back once her closing sentence has actually finished playing. */
      const drainThenDone = (): void => {
        if (stopped || handedBack) return;
        const deadline = Date.now() + DRAIN_MAX_MS;
        const tick = (): void => {
          if (stopped || handedBack) return;
          if (player.isPlaying() && Date.now() < deadline) {
            drainTimer = setTimeout(tick, DRAIN_POLL_MS);
            return;
          }
          handedBack = true;
          io.done();
        };
        tick();
      };

      /**
       * turnComplete arrives while her voice is still queued ahead of the
       * clock, so the avatar keeps speaking until the speaker is actually idle.
       */
      const settleToListening = (): void => {
        stateTimer = clearTimer(stateTimer);
        const tick = (): void => {
          if (stopped || handedBack) return;
          if (player.isPlaying()) {
            stateTimer = setTimeout(tick, DRAIN_POLL_MS);
            return;
          }
          setState('listening');
        };
        tick();
      };

      /** The student's utterance is over the moment the tutor starts replying. */
      const finalizeStudent = (): void => {
        if (studentFinal || studentLine.length === 0) return;
        studentFinal = true;
        emit('student', studentLine, true);
      };

      const handleToolCalls = (calls: LiveToolCall[]): void => {
        finalizeStudent();
        const functionResponses = calls.map((call) => {
          if (call.name === RECALL_TOOL) {
            const beatId = pickRecallBeatId(call.args, validIds);
            if (beatId === null) {
              return {
                id: call.id,
                name: call.name,
                response: {
                  error: `No moment with that id in this class. Valid ids: ${[...validIds].join(', ')}.`,
                },
              };
            }
            if (!stopped) io.recall(beatId);
            return { id: call.id, name: call.name, response: { result: 'shown', beatId } };
          }

          if (call.name === END_TOOL) {
            endRequested = true;
            // She may still be mid-sentence; the actual hand-back waits for the
            // turn to close and her voice to drain. This is only the backstop.
            backstopTimer = clearTimer(backstopTimer);
            backstopTimer = setTimeout(drainThenDone, END_BACKSTOP_MS);
            return { id: call.id, name: call.name, response: { result: 'ok' } };
          }

          return {
            id: call.id,
            name: call.name,
            response: { error: `Unknown tool "${call.name}".` },
          };
        });
        send({ toolResponse: { functionResponses } });
      };

      const handleEvent = (event: LiveServerEvent): void => {
        switch (event.type) {
          case 'setupComplete': {
            ready = true;
            setupTimer = clearTimer(setupTimer);
            setState('listening');
            // She does NOT greet here, and that is deliberate.
            //
            // The handoff has already spoken the bridge line — "Yes, go ahead,
            // good place to stop. We were right in the middle of X. What's your
            // doubt?" — in this same voice, before this session was even opened
            // (see raiseHand in @ai-tutor/doubt-session). A model-side greeting
            // on top of it is the student being welcomed twice in four seconds,
            // at exactly the seam the whole product is built around.
            //
            // It also keeps every live model usable: asking a model to speak
            // first is the one thing that is blocked on 3.1. Silence here is
            // not dead air — she is listening, and the student was just asked a
            // question.
            break;
          }

          case 'audio': {
            finalizeStudent();
            setState('speaking');
            player.enqueue(event.data);
            break;
          }

          case 'transcript': {
            if (event.role === 'student') {
              // A fragment after the line was closed opens the next utterance.
              if (studentFinal) {
                studentLine = '';
                studentFinal = false;
              }
              studentLine += event.text;
              emit('student', studentLine, false);
            } else {
              finalizeStudent();
              tutorLine += event.text;
              emit('tutor', tutorLine, false);
            }
            break;
          }

          case 'interrupted': {
            // Barge-in: the student started talking over her. Drop every queued
            // chunk at once, or she keeps speaking for seconds after they cut in.
            player.stop();
            emit('tutor', tutorLine, true);
            tutorLine = '';
            settleToListening();
            break;
          }

          case 'turnComplete': {
            finalizeStudent();
            emit('tutor', tutorLine, true);
            tutorLine = '';
            if (endRequested) drainThenDone();
            else settleToListening();
            break;
          }

          case 'toolCall': {
            handleToolCalls(event.calls);
            break;
          }
        }
      };

      const readFrame = async (data: unknown): Promise<string> => {
        if (typeof data === 'string') return data;
        if (typeof Blob !== 'undefined' && data instanceof Blob) return await data.text();
        if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
        return '';
      };

      const connect = async (): Promise<void> => {
        setState('connecting');

        // Mic first. If it is going to be refused, it must be refused before a
        // socket (and a billing session) is open.
        mic = createMicCapture((pcm) => {
          if (stopped) return;
          const muted = opts.isMuted?.() ?? false;
          // Level is reported even before setup completes, so the waveform is
          // alive from the moment the mic opens.
          opts.onMicLevel?.(muted ? 0 : micLevelOf(pcm));
          if (muted) return;
          if (!ready) return; // audio sent before setupComplete is rejected
          send({
            realtimeInput: {
              audio: {
                data: int16ToBase64(pcm),
                mimeType: `audio/pcm;rate=${MIC_SAMPLE_RATE}`,
              },
            },
          });
        });

        try {
          await mic.start();
        } catch {
          fail(MIC_FAIL_LINE);
          return;
        }
        if (stopped) return;

        const socket = new WebSocket(`${LIVE_ENDPOINT}?key=${encodeURIComponent(opts.apiKey)}`);
        ws = socket;

        socket.onopen = (): void => send(buildSetupFrame(ctx, models[modelIndex], opts.student));
        socket.onmessage = (ev: MessageEvent): void => {
          void readFrame(ev.data).then((raw) => {
            if (stopped) return; // frames still arriving after stop() are dropped
            for (const event of parseServerMessage(raw)) handleEvent(event);
          });
        };
        socket.onerror = (): void => fail(ready ? DROPPED_LINE : CONNECT_FAIL_LINE);
        socket.onclose = (): void => {
          if (handedBack) return; // the doubt already ended cleanly
          fail(ready ? DROPPED_LINE : CONNECT_FAIL_LINE);
        };

        setupTimer = setTimeout(() => {
          if (!ready) fail(CONNECT_FAIL_LINE);
        }, SETUP_TIMEOUT_MS);
      };

      void connect().catch(() => fail(CONNECT_FAIL_LINE));

      return {
        sendUserText(text: string): void {
          if (stopped || !ready || text.length === 0) return;
          // Typing still works alongside voice; surface it as a caption too,
          // since no input transcription comes back for a typed turn.
          emit('student', text, true);
          send({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text }] }],
              turnComplete: true,
            },
          });
        },
        stop(): void {
          stopped = true;
          teardown();
        },
      };
    },
  };
}
