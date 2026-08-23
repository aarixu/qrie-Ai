import {
  isRecallable,
  recallTargets,
  type AgentAdapter,
  type AgentIO,
  type AgentSession,
  type DoubtContext,
} from '@ai-tutor/doubt-session';
import type { StudentContext } from '@ai-tutor/persona';
import {
  END_DOUBT,
  RECALL_MOMENT,
  TUTOR_CONTROL_TOPIC,
  decodeTutorControl,
} from '@ai-tutor/agent/src/messages.ts';
import {
  DOUBT_PATH,
  TOKEN_PATH,
  type DoubtBrief,
  type DoubtRequest,
  type DoubtResponse,
  type TokenRequest,
  type TokenResponse,
} from '@ai-tutor/agent/src/protocol.ts';
import type { LiveState, TranscriptLine } from './liveAgent';

/**
 * THE FOURTH TUTOR: the live doubt session over LiveKit, behind the same
 * AgentAdapter the stub, the text agent and the browser-direct voice agent all
 * implement. The seam — bridges, states, canvas recall — lives in
 * @ai-tutor/doubt-session and does not know this file exists.
 *
 * The difference from ./liveAgent.ts is where the model runs. There, the
 * browser holds the Gemini key and talks to the Live API itself. Here the
 * browser holds nothing: it asks apps/agent's token server for a short-lived
 * join token, joins a room, publishes its microphone, and a worker process
 * brings the tutor in. That is what buys a key that never reaches a student's
 * device, and a room an avatar can later publish video into.
 *
 * Two rules shape everything below, in this order, and they are the same two
 * rules ./liveAgent.ts encodes:
 *  1. The class must NEVER get stuck. Every failure path — a token server that
 *     is down, a refused microphone, a tutor who never joins, a connection that
 *     drops mid-answer — says one short friendly line through io.say and then
 *     io.done(), handing the room back to the recording.
 *  2. After stop(), no io calls at all. Packets still in flight are dropped.
 *
 * The tutor's VOICE arrives on her audio track and is played by an <audio>
 * element, not by io.say. io.say is the app's TTS path; routing her speech
 * through it would play every sentence twice. It is used only for the short
 * failure lines above.
 *
 * WIRING NOTE for apps/classroom: on this path she greets the student herself
 * (the worker opens with generateReply in the DOUBT_OPENING moment), so do NOT
 * also speak entryLine() from @ai-tutor/doubt-session, or the student hears two
 * greetings. exitLine() is still the app's, spoken after io.done().
 */

// ---------------------------------------------------------------------------
// Names owned by the LiveKit agents framework
// ---------------------------------------------------------------------------

/**
 * These five strings belong to @livekit/agents (its constants.ts), which is a
 * Node package and not a dependency of the browser app — so they are written
 * out here rather than imported. They are the framework's reserved `lk.*`
 * namespace, which it does not rename lightly. The room control messages, which
 * we DO own, are imported from apps/agent rather than copied.
 */
const TRANSCRIPTION_TOPIC = 'lk.transcription';
const CHAT_TOPIC = 'lk.chat';
const FINAL_ATTRIBUTE = 'lk.transcription_final';
const SEGMENT_ATTRIBUTE = 'lk.segment_id';
const AGENT_STATE_ATTRIBUTE = 'lk.agent.state';

/** Track.Source.Microphone. A string, so no enum has to cross this boundary. */
const MIC_SOURCE = 'microphone';

// ---------------------------------------------------------------------------
// Timings, and the lines we say when something breaks
// ---------------------------------------------------------------------------

/**
 * How long the room waits for the tutor's voice after the dispatch is accepted.
 * The worker forks a child process and opens a realtime session inside it, so a
 * cold first doubt is genuinely slow — but a student staring at a paused class
 * has to be given the class back long before they start tapping things.
 */
export const AGENT_JOIN_TIMEOUT_MS = 20_000;

/**
 * How often the mute switch and the microphone level are sampled. Mute is
 * polled rather than pushed because AgentSession has exactly two methods, and
 * the app already hands ./liveAgent.ts the same `isMuted` closure — one options
 * shape, so choosing which tutor to build stays a one-line change.
 */
export const MIC_POLL_MS = 150;

const CONNECT_FAIL_LINE =
  "Sorry, I couldn't get through to your tutor just now. Let's carry on with the class — raise your hand again in a moment.";
const MIC_FAIL_LINE =
  "I can't hear your microphone. Let's continue the class — check the mic permission and try raising your hand again.";
const NO_TUTOR_LINE =
  "Sorry, I couldn't join you in time. Let's carry on with the class — raise your hand again and I'll be there.";
const DROPPED_LINE =
  "Oh, we got cut off there. Let's carry on with the class — raise your hand again and we'll pick this up.";
const FAILED_LINE =
  "Sorry, something went wrong at my end. Let's carry on with the class — raise your hand again whenever you need me.";

// ---------------------------------------------------------------------------
// The slice of livekit-client this adapter uses
// ---------------------------------------------------------------------------
//
// Written out as interfaces rather than imported, for one reason: everything
// below can then be driven by a plain object in a test, so every failure path
// is provable without WebRTC, a server or a microphone. The default factory at
// the end of this section builds a real `Room` and returns it as one of these,
// which is where the compiler checks that the two still agree.

/** One remote media track — as much of livekit-client's RemoteTrack as we use. */
export interface RemoteMediaTrack {
  /** 'audio' or 'video'. */
  readonly kind: string;
  /** With no element: builds a DETACHED one. It plays nothing until appended. */
  attach(): HTMLMediaElement;
  attach(element: HTMLMediaElement): HTMLMediaElement;
  /** Detaches from every element it was attached to, and returns them. */
  detach(): HTMLMediaElement[];
}

export interface RemoteParticipantLike {
  getTrackPublications(): { readonly track?: RemoteMediaTrack | undefined }[];
  readonly attributes: Record<string, string>;
}

export interface LocalParticipantLike {
  /**
   * Mutes and unmutes the microphone. It does NOT unpublish: livekit-client
   * calls track.mute() for every source except screen share. That matters —
   * dropping the track would take the session's voice activity detection with
   * it, and the student's next question would go unanswered.
   */
  setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  sendText(text: string, options?: { topic?: string }): Promise<unknown>;
  getTrackPublication(
    source: string,
  ): { readonly track?: { readonly mediaStreamTrack: MediaStreamTrack } | undefined } | undefined;
}

/**
 * A transcription segment as it arrives. Iterating yields the WHOLE line so
 * far, never a delta, which is exactly the shape TranscriptLine.text wants.
 */
export interface TranscriptStreamReader extends AsyncIterable<string> {
  readonly info: { readonly attributes?: Record<string, string> | undefined };
}

export type TranscriptStreamHandler = (
  reader: TranscriptStreamReader,
  participant: { identity: string },
) => void;

export interface LiveKitRoom {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Unblocks playback that the browser's autoplay policy held back. */
  startAudio(): Promise<void>;
  readonly localParticipant: LocalParticipantLike;
  readonly remoteParticipants: ReadonlyMap<string, RemoteParticipantLike>;
  registerTextStreamHandler(topic: string, handler: TranscriptStreamHandler): void;
  unregisterTextStreamHandler(topic: string): void;
  on(
    event: 'dataReceived',
    handler: (
      payload: Uint8Array,
      participant: unknown,
      kind: unknown,
      topic: string | undefined,
    ) => void,
  ): void;
  on(event: 'trackSubscribed', handler: (track: RemoteMediaTrack) => void): void;
  on(event: 'trackUnsubscribed', handler: (track: RemoteMediaTrack) => void): void;
  on(
    event: 'participantAttributesChanged',
    handler: (changed: Record<string, string>) => void,
  ): void;
  on(event: 'disconnected', handler: () => void): void;
}

export type RoomFactory = () => Promise<LiveKitRoom>;

/**
 * livekit-client is ~135 KB gzip and cannot be tree-shaken — its package has no
 * `sideEffects` field and it runs a webrtc-adapter bootstrap at module scope.
 * Most students never raise a hand, so it is imported HERE, inside start(), and
 * never at module top level: a student who only watches downloads none of it.
 */
const defaultRoomFactory: RoomFactory = async () => {
  const { Room } = await import('livekit-client');
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
};

// ---------------------------------------------------------------------------
// Microphone level (display only)
// ---------------------------------------------------------------------------

export interface LevelMeter {
  /** 0..1 energy, sampled now. */
  read(): number;
  close(): void;
}

/** Null when the platform has no Web Audio — the waveform is not worth a crash. */
export type LevelMeterFactory = (track: MediaStreamTrack) => LevelMeter | null;

/**
 * The same perceptual scaling as the browser-direct path's `micLevelOf`: raw
 * speech RMS sits around 0.02–0.15 and would leave the bars looking dead.
 */
const LEVEL_GAIN = 6;

const webAudioLevelMeter: LevelMeterFactory = (track) => {
  if (typeof AudioContext === 'undefined') return null;
  try {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    // Deliberately NOT connected onward to context.destination: that would play
    // the student's own microphone back out of their speaker.
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    return {
      read(): number {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        return Math.min(1, Math.sqrt(sum / samples.length) * LEVEL_GAIN);
      },
      close(): void {
        source.disconnect();
        void context.close().catch(() => undefined);
      },
    };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

/** The avatar's video, once one exists. See {@link LiveKitAgentOptions.onAgentVideo}. */
export interface AgentVideo {
  /** Render into an element the classroom owns. */
  attach(element: HTMLVideoElement): void;
  detach(): void;
}

/** Everything the brief needs that DoubtContext does not carry. */
export interface DoubtStudent {
  /**
   * The student's LiveKit identity. Unique per connection: a second join with
   * the same identity kicks the first one out of the room.
   */
  identity: string;
  /** What the tutor calls them. */
  name?: string;
  /** e.g. "Science" — persona omits the line when it is absent. */
  subject?: string;
  /** The lesson's own title. */
  title?: string;
  /** The class they are in, and how they are doing. `klass` is required. */
  student: StudentContext;
}

export interface LiveKitAgentOptions extends DoubtStudent {
  /** Base URL of apps/agent's token server, e.g. 'http://127.0.0.1:7890'. */
  tokenServerUrl: string;
  /** Captions for both sides of the conversation. */
  onTranscript?: (line: TranscriptLine) => void;
  /** Room state for the avatar / mic indicator. */
  onState?: (state: LiveState) => void;
  /** 0..1 microphone energy, for the waveform. Display only. */
  onMicLevel?: (level: number) => void;
  /**
   * Fires when the tutor publishes video, and with null when it goes away.
   * There is no avatar today, so today it never fires — which is the honest way
   * to leave the seam open rather than pretending the slot is not there.
   */
  onAgentVideo?: (video: AgentVideo | null) => void;
  /**
   * Polled every {@link MIC_POLL_MS}. Muting mutes the published track; it
   * never unpublishes it.
   */
  isMuted?: () => boolean;
  /** Injected in tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected in tests. Defaults to a real livekit-client Room. */
  createRoom?: RoomFactory;
  /** Injected in tests. Defaults to a Web Audio analyser on the mic track. */
  createLevelMeter?: LevelMeterFactory;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * One room per student per lesson. Derived rather than configured, so two
 * students can never be handed the same room and a second raised hand in the
 * same lesson lands back in the room the first one used.
 */
export function doubtRoomName(lessonId: string, identity: string): string {
  return `doubt-${lessonId}-${identity}`;
}

/**
 * DoubtContext (what the classroom knows) to DoubtBrief (what the worker is
 * told, on the dispatch). The two field renames are apps/agent's, because the
 * brief is fed straight into @ai-tutor/persona's LessonContext:
 * visibleElementIds becomes onScreen, recentBeats becomes recallableBeats.
 *
 * Named for the dispatch it travels on, because @ai-tutor/doubt-session already
 * exports a `buildDoubtBrief` and that one builds her system prompt. Two
 * briefings, two names.
 */
export function dispatchBrief(ctx: DoubtContext, who: DoubtStudent): DoubtBrief {
  const brief: DoubtBrief = {
    lessonId: ctx.lessonId,
    beatId: ctx.beatId,
    beatTopic: ctx.beatTopic,
    transcriptSoFar: ctx.transcriptSoFar,
    // Copies, so the worker's briefing can never be a live view of the lesson.
    onScreen: [...ctx.visibleElementIds],
    // The package's list, not our own map: the ids the tutor is offered and the
    // ids we later accept back have to be one set, or she names a moment on
    // screen and nothing appears.
    recallableBeats: [...recallTargets(ctx)],
    studentIdentity: who.identity,
    student: who.student,
  };
  if (who.name !== undefined) brief.studentName = who.name;
  if (who.subject !== undefined) brief.subject = who.subject;
  if (who.title !== undefined) brief.title = who.title;
  return brief;
}

/**
 * The tutor's own report of what she is doing, mapped to the state the doubt
 * sheet renders. `thinking` counts as speaking: from the student's side the
 * answer has already begun, and flicking back to "listening" between her last
 * word and her first sound reads as a tutor who lost interest.
 *
 * An unrecognised value returns null — leave the UI showing what it shows,
 * rather than invent a state for a word this framework version did not have.
 */
export function agentLiveState(attribute: string | undefined): LiveState | null {
  switch (attribute) {
    case 'speaking':
    case 'thinking':
      return 'speaking';
    case 'listening':
      return 'listening';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

type Role = TranscriptLine['role'];

/** A caption line being built up, and the segment it belongs to. */
interface OpenLine {
  segment: string;
  text: string;
}

export function createLiveKitAgent(opts: LiveKitAgentOptions): AgentAdapter {
  const createRoom = opts.createRoom ?? defaultRoomFactory;
  const createLevelMeter = opts.createLevelMeter ?? webAudioLevelMeter;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.tokenServerUrl.replace(/\/+$/, '');

  return {
    start(ctx: DoubtContext, io: AgentIO): AgentSession {
      let stopped = false;
      let handedBack = false;
      /** Her audio track has arrived: the room really is live. */
      let tutorHeard = false;

      const roomName = doubtRoomName(ctx.lessonId, opts.identity);

      let room: LiveKitRoom | null = null;
      let meter: LevelMeter | null = null;
      let joinTimer: ReturnType<typeof setTimeout> | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;

      /** Tracks we attached, so teardown can take every element back out. */
      const attached = new Set<RemoteMediaTrack>();
      const audioElements = new Set<HTMLMediaElement>();
      const open: Record<Role, OpenLine | null> = { student: null, tutor: null };

      const clearTimer = (timer: ReturnType<typeof setTimeout> | null): null => {
        if (timer !== null) clearTimeout(timer);
        return null;
      };

      const setState = (state: LiveState): void => {
        if (!stopped) opts.onState?.(state);
      };

      const emit = (role: Role, text: string, final: boolean): void => {
        if (!stopped && text.length > 0) opts.onTranscript?.({ role, text, final });
      };

      const detachTrack = (track: RemoteMediaTrack): void => {
        attached.delete(track);
        for (const element of track.detach()) {
          // Only the audio elements are ours to remove; a video element was
          // handed to us by the classroom and stays where the classroom put it.
          if (audioElements.delete(element)) element.remove();
        }
      };

      const teardown = (): void => {
        joinTimer = clearTimer(joinTimer);
        pollTimer = clearTimer(pollTimer);
        meter?.close();
        meter = null;
        for (const track of [...attached]) detachTrack(track);
        if (room !== null) {
          const leaving = room;
          room = null;
          leaving.unregisterTextStreamHandler(TRANSCRIPTION_TOPIC);
          // Every caller has already set `stopped` or `handedBack`, so the
          // 'disconnected' this raises cannot re-enter the failure path below.
          void leaving.disconnect().catch(() => undefined);
        }
      };

      /** Rule 1: say one short line, then hand the room back. Never hold it. */
      const fail = (line: string): void => {
        if (stopped || handedBack) return;
        handedBack = true;
        setState('error');
        // Tear down before speaking, so her half-finished sentence cannot talk
        // over the apology and the microphone indicator goes out at once.
        teardown();
        void io
          .say(line)
          .catch(() => undefined)
          .then(() => {
            if (!stopped) io.done();
          });
      };

      /** She finished and spoke her own closing line. Nothing left to say. */
      const finish = (): void => {
        if (stopped || handedBack) return;
        handedBack = true;
        teardown();
        io.done();
      };

      const post = async <T>(path: string, body: TokenRequest | DoubtRequest): Promise<T> => {
        const response = await fetchImpl(`${base}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`${path} answered ${response.status}`);
        return (await response.json()) as T;
      };

      // --- captions ---------------------------------------------------------

      /**
       * Close the caption line a role had open, when a NEW segment starts.
       *
       * Finality cannot be read from one signal alone: the framework publishes
       * a segment either as repeated whole-text streams, the last of which
       * carries lk.transcription_final, or as one long delta stream opened
       * before anyone knew it would be the final one. So a line closes on that
       * attribute or on the next segment arriving, whichever happens first.
       */
      const closeSegment = (role: Role, segment: string): void => {
        const line = open[role];
        if (line === null || line.segment === segment) return;
        emit(role, line.text, true);
        open[role] = null;
      };

      const readTranscript = async (role: Role, reader: TranscriptStreamReader): Promise<void> => {
        const attributes = reader.info.attributes ?? {};
        const segment = attributes[SEGMENT_ATTRIBUTE] ?? '';
        closeSegment(role, segment);

        try {
          // Each yield is the whole line so far, which is what the UI renders.
          for await (const soFar of reader) {
            if (stopped) return;
            open[role] = { segment, text: soFar };
            emit(role, soFar, false);
          }
        } catch {
          // A stream cut off mid-sentence leaves its partial line on screen.
          // Nothing about the conversation depends on captions.
          return;
        }

        if (stopped || attributes[FINAL_ATTRIBUTE] !== 'true') return;
        const line = open[role];
        if (line === null) return;
        emit(role, line.text, true);
        open[role] = null;
      };

      // --- room events ------------------------------------------------------

      const adopt = (track: RemoteMediaTrack): void => {
        if (stopped || attached.has(track)) return;
        attached.add(track);

        if (track.kind === 'video') {
          opts.onAgentVideo?.({
            attach: (element: HTMLVideoElement): void => {
              track.attach(element);
            },
            detach: (): void => {
              track.detach();
            },
          });
          return;
        }

        // attach() with no argument builds a DETACHED element; nothing comes
        // out of the speaker until it is actually in the page.
        const element = track.attach();
        element.style.display = 'none';
        document.body.appendChild(element);
        audioElements.add(element);

        tutorHeard = true;
        joinTimer = clearTimer(joinTimer);
        setState('listening');
      };

      const handleControl = (payload: Uint8Array, topic: string | undefined): void => {
        // Filter on the topic, not the sender: LiveKit publishes its own
        // transcriptions on lk.transcription, and the sender identity can
        // arrive undefined when the tutor leaves in the same breath as her last
        // packet.
        if (stopped || topic !== TUTOR_CONTROL_TOPIC) return;
        const message = decodeTutorControl(payload);
        if (message === null) return;

        if (message.type === RECALL_MOMENT) {
          // The worker validated this id too. Both sides validate, because the
          // canvas is the thing that breaks: an id from later in the lesson
          // would spoil it, and one that does not exist would blank the board.
          if (isRecallable(ctx, message.beatId)) io.recall(message.beatId);
          return;
        }

        if (message.type === END_DOUBT) {
          // 'resolved' means she has already spoken her closing line, so the
          // room goes back in silence. 'failed' means she said nothing at all,
          // and a student cannot be left wondering why the class stopped.
          if (message.reason === 'failed') fail(FAILED_LINE);
          else finish();
        }
      };

      const wire = (joined: LiveKitRoom): void => {
        joined.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, participant) => {
          // The framework republishes the student's own words under the
          // student's identity (streamText senderIdentity), so one comparison
          // separates the two sides of the conversation.
          const role: Role = participant.identity === opts.identity ? 'student' : 'tutor';
          void readTranscript(role, reader);
        });

        joined.on('dataReceived', (payload, _participant, _kind, topic) => {
          handleControl(payload, topic);
        });
        joined.on('trackSubscribed', adopt);
        joined.on('trackUnsubscribed', (track) => {
          if (stopped) return;
          detachTrack(track);
          if (track.kind === 'video') opts.onAgentVideo?.(null);
        });
        joined.on('participantAttributesChanged', (changed) => {
          const next = agentLiveState(changed[AGENT_STATE_ATTRIBUTE]);
          if (next !== null && tutorHeard) setState(next);
        });
        joined.on('disconnected', () => {
          // Our own teardown flags the session first, so this is only ever
          // something taking the room away underneath us.
          fail(tutorHeard ? DROPPED_LINE : CONNECT_FAIL_LINE);
        });
      };

      /**
       * TrackSubscribed does not fire for tracks of participants who were
       * already in the room when we connected. A reconnect inside a doubt lands
       * exactly there, and without this the sheet says "connecting" forever
       * while the tutor talks to nobody.
       */
      const adoptExisting = (joined: LiveKitRoom): void => {
        for (const participant of joined.remoteParticipants.values()) {
          for (const publication of participant.getTrackPublications()) {
            if (publication.track !== undefined) adopt(publication.track);
          }
          const state = agentLiveState(participant.attributes[AGENT_STATE_ATTRIBUTE]);
          if (state !== null && tutorHeard) setState(state);
        }
      };

      // --- microphone -------------------------------------------------------

      const pollMicrophone = (joined: LiveKitRoom): void => {
        const publication = joined.localParticipant.getTrackPublication(MIC_SOURCE);
        const track = publication?.track;
        meter = track === undefined ? null : createLevelMeter(track.mediaStreamTrack);

        let live = true;
        const tick = (): void => {
          if (stopped || handedBack) return;
          const muted = opts.isMuted?.() ?? false;

          if (muted === live) {
            live = !muted;
            // MUTE, NEVER UNPUBLISH. Unpublishing would drop the track the
            // session's voice activity detection listens to, and the student's
            // next question would go unanswered.
            void joined.localParticipant.setMicrophoneEnabled(live).catch(() => undefined);
          }
          if (meter !== null) opts.onMicLevel?.(muted ? 0 : meter.read());

          pollTimer = setTimeout(tick, MIC_POLL_MS);
        };
        tick();
      };

      // --- the sequence -----------------------------------------------------

      const connect = async (): Promise<void> => {
        setState('connecting');

        // The module download and the token round-trip both sit on the critical
        // path of a class that has already stopped, so they overlap. A Room
        // built while the token fetch fails is inert — it holds nothing until
        // connect() — and is dropped along with everything else.
        const [session, joined] = await Promise.all([
          post<TokenResponse>(TOKEN_PATH, {
            room: roomName,
            identity: opts.identity,
            ...(opts.name === undefined ? {} : { name: opts.name }),
          }),
          createRoom(),
        ]);
        if (stopped) {
          void joined.disconnect().catch(() => undefined);
          return;
        }
        room = joined;

        // Handlers first: a packet arriving between connect() resolving and the
        // next line running is a packet nobody is listening for.
        wire(joined);
        await joined.connect(session.url, session.token);
        if (stopped || handedBack) return;

        try {
          await joined.localParticipant.setMicrophoneEnabled(true);
        } catch {
          fail(MIC_FAIL_LINE);
          return;
        }
        if (stopped || handedBack) return;

        // The raise-hand tap is the page's user gesture — spend it here, or the
        // autoplay policy can leave the tutor's voice silently blocked.
        await joined.startAudio().catch(() => undefined);
        if (stopped || handedBack) return;

        pollMicrophone(joined);
        adoptExisting(joined);

        // She is dispatched only now. Sent any earlier she walks into an empty
        // room and speaks her opening line — the first half of the seam — to
        // nobody, while the browser is still negotiating WebRTC.
        await post<DoubtResponse>(DOUBT_PATH, {
          room: roomName,
          brief: dispatchBrief(ctx, opts),
        });
        if (stopped || handedBack) return;

        joinTimer = setTimeout(() => {
          if (!tutorHeard) fail(NO_TUTOR_LINE);
        }, AGENT_JOIN_TIMEOUT_MS);
      };

      void connect().catch(() => fail(CONNECT_FAIL_LINE));

      return {
        sendUserText(text: string): void {
          if (stopped || room === null || !tutorHeard || text.length === 0) return;
          // A typed turn produces no input transcription, so it is captioned
          // here or it never appears in the sheet at all.
          emit('student', text, true);
          void room.localParticipant.sendText(text, { topic: CHAT_TOPIC }).catch(() => undefined);
        },
        stop(): void {
          stopped = true;
          teardown();
        },
      };
    },
  };
}
