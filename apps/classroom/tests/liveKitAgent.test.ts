import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentIO, AgentSession, DoubtContext } from '@ai-tutor/doubt-session';
import { TUTOR_CONTROL_TOPIC, encodeTutorControl } from '@ai-tutor/agent/src/messages.ts';
import type { DoubtResponse, TokenResponse } from '@ai-tutor/agent/src/protocol.ts';
import type { LiveState, TranscriptLine } from '../src/lib/liveAgent';
import {
  AGENT_JOIN_TIMEOUT_MS,
  MIC_POLL_MS,
  agentLiveState,
  createLiveKitAgent,
  dispatchBrief,
  doubtRoomName,
  type AgentVideo,
  type LiveKitAgentOptions,
  type LiveKitRoom,
  type RemoteMediaTrack,
  type RemoteParticipantLike,
  type TranscriptStreamHandler,
  type TranscriptStreamReader,
} from '../src/lib/liveKitAgent';

const ctx: DoubtContext = {
  lessonId: 'class10-heart',
  beatId: 'chambers',
  beatTopic: 'Four chambers',
  transcriptSoFar: 'The heart is a pump.\nIt has four chambers.',
  visibleElementIds: ['b_ra', 'b_la'],
  recentBeats: [
    { id: 'pump', topic: 'The heart is a pump' },
    { id: 'valves', topic: 'Valves stop backflow' },
    { id: 'chambers', topic: 'Four chambers' },
  ],
};

const IDENTITY = 'student-42';
const ROOM = doubtRoomName(ctx.lessonId, IDENTITY);

// ---------------------------------------------------------------------------
// Fakes — no network, no WebRTC, no microphone, no Web Audio
// ---------------------------------------------------------------------------

interface IoLog {
  said: string[];
  recalled: string[];
  dones: number;
}

function fakeIo(): { io: AgentIO; log: IoLog } {
  const log: IoLog = { said: [], recalled: [], dones: 0 };
  const io: AgentIO = {
    say: async (text: string): Promise<void> => {
      log.said.push(text);
    },
    recall: (beatId: string): void => {
      log.recalled.push(beatId);
    },
    done: (): void => {
      log.dones += 1;
    },
  };
  return { io, log };
}

function fakeTrack(kind: 'audio' | 'video'): RemoteMediaTrack {
  const elements: HTMLMediaElement[] = [];
  return {
    kind,
    attach(element?: HTMLMediaElement): HTMLMediaElement {
      const target = element ?? document.createElement(kind === 'audio' ? 'audio' : 'video');
      elements.push(target);
      return target;
    },
    detach(): HTMLMediaElement[] {
      const out = [...elements];
      elements.length = 0;
      return out;
    },
  };
}

function fakeReader(chunks: string[], attributes: Record<string, string>): TranscriptStreamReader {
  return {
    info: { attributes },
    async *[Symbol.asyncIterator](): AsyncGenerator<string> {
      for (const chunk of chunks) yield chunk;
    },
  };
}

interface MicLog {
  /** Every setMicrophoneEnabled argument, in order. */
  enables: boolean[];
  /** How many times a track was actually published. */
  publishes: number;
  /** True from the first publish until something unpublishes — nothing does. */
  published: boolean;
}

interface FakeRoom {
  room: LiveKitRoom;
  /** Raise a room event, the way livekit-client would. */
  fire(event: string, ...args: unknown[]): void;
  /** Deliver one transcription segment. */
  transcribe(identity: string, reader: TranscriptStreamReader): void;
  participants: Map<string, RemoteParticipantLike>;
  connects: { url: string; token: string }[];
  disconnects: number;
  sent: { text: string; topic: string | undefined }[];
  mic: MicLog;
  /** Fails the next setMicrophoneEnabled(true), the way a refused mic does. */
  refuseMic: boolean;
  handlerTopics(): string[];
}

function fakeRoom(): FakeRoom {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const streams = new Map<string, TranscriptStreamHandler>();
  const participants = new Map<string, RemoteParticipantLike>();
  const connects: { url: string; token: string }[] = [];
  const sent: { text: string; topic: string | undefined }[] = [];
  const mic: MicLog = { enables: [], publishes: 0, published: false };
  const counters = { disconnects: 0 };
  const state = { refuseMic: false };

  // The microphone's own MediaStreamTrack never leaves the fake: the level
  // meter is injected in the one test that looks at it.
  const micTrack = { mediaStreamTrack: {} as MediaStreamTrack };

  const fire = (event: string, ...args: unknown[]): void => {
    for (const handler of [...(handlers.get(event) ?? [])]) handler(...args);
  };

  const room: LiveKitRoom = {
    async connect(url: string, token: string): Promise<void> {
      connects.push({ url, token });
    },
    async disconnect(): Promise<void> {
      counters.disconnects += 1;
      // The real client emits Disconnected for its own disconnect too, which is
      // exactly the re-entry the adapter has to survive.
      fire('disconnected');
    },
    async startAudio(): Promise<void> {},
    localParticipant: {
      async setMicrophoneEnabled(enabled: boolean): Promise<unknown> {
        if (enabled && state.refuseMic) throw new Error('NotAllowedError');
        mic.enables.push(enabled);
        // Publishing happens once, on the first enable. Muting NEVER takes the
        // publication away — that is the behaviour the adapter depends on.
        if (enabled && !mic.published) {
          mic.published = true;
          mic.publishes += 1;
        }
        return undefined;
      },
      async sendText(text: string, options?: { topic?: string }): Promise<unknown> {
        sent.push({ text, topic: options?.topic });
        return undefined;
      },
      getTrackPublication() {
        return { track: micTrack };
      },
    },
    remoteParticipants: participants,
    registerTextStreamHandler(topic: string, handler: TranscriptStreamHandler): void {
      streams.set(topic, handler);
    },
    unregisterTextStreamHandler(topic: string): void {
      streams.delete(topic);
    },
    on(event: string, handler: (...args: never[]) => void): void {
      // One `on` stands in for five typed overloads, so the arguments it will
      // eventually be called with are only known to `fire` below.
      const listener = handler as (...args: unknown[]) => void;
      handlers.set(event, [...(handlers.get(event) ?? []), listener]);
    },
  };

  return {
    room,
    fire,
    transcribe(identity: string, reader: TranscriptStreamReader): void {
      streams.get('lk.transcription')?.(reader, { identity });
    },
    participants,
    connects,
    get disconnects(): number {
      return counters.disconnects;
    },
    sent,
    mic,
    get refuseMic(): boolean {
      return state.refuseMic;
    },
    set refuseMic(value: boolean) {
      state.refuseMic = value;
    },
    handlerTopics(): string[] {
      return [...streams.keys()];
    },
  };
}

interface Answer {
  ok: boolean;
  status: number;
  body: unknown;
}

const TOKEN_OK: Answer = {
  ok: true,
  status: 200,
  body: {
    url: 'ws://127.0.0.1:7880',
    token: 'a.join.jwt',
    room: ROOM,
    identity: IDENTITY,
    expiresInSec: 900,
  } satisfies TokenResponse,
};

const DOUBT_OK: Answer = {
  ok: true,
  status: 200,
  body: { dispatchId: 'AD_1', room: ROOM, agentName: 'ai-tutor-doubt' } satisfies DoubtResponse,
};

function fakeFetch(answers: Record<string, Answer>): {
  impl: typeof fetch;
  posts: { path: string; body: unknown }[];
} {
  const posts: { path: string; body: unknown }[] = [];
  const impl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    posts.push({ path, body: JSON.parse(String(init?.body)) as unknown });
    const answer = answers[path] ?? { ok: false, status: 404, body: {} };
    return {
      ok: answer.ok,
      status: answer.status,
      json: async (): Promise<unknown> => answer.body,
    } as unknown as Response;
  };
  return { impl, posts };
}

interface Harness {
  session: AgentSession;
  io: IoLog;
  room: FakeRoom;
  posts: { path: string; body: unknown }[];
  states: LiveState[];
  lines: TranscriptLine[];
  videos: (AgentVideo | null)[];
  levels: number[];
}

/** Drain the promise chain inside start() without letting a real clock run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

async function start(
  overrides: Partial<LiveKitAgentOptions> = {},
  answers: Record<string, Answer> = { '/token': TOKEN_OK, '/doubt': DOUBT_OK },
  prepare?: (room: FakeRoom) => void,
): Promise<Harness> {
  const { io, log } = fakeIo();
  const room = fakeRoom();
  prepare?.(room);
  const { impl, posts } = fakeFetch(answers);

  const states: LiveState[] = [];
  const lines: TranscriptLine[] = [];
  const videos: (AgentVideo | null)[] = [];
  const levels: number[] = [];

  const session = createLiveKitAgent({
    tokenServerUrl: 'http://127.0.0.1:7890',
    identity: IDENTITY,
    name: 'Aarav',
    student: { klass: 8 },
    onState: (state) => states.push(state),
    onTranscript: (line) => lines.push(line),
    onAgentVideo: (video) => videos.push(video),
    onMicLevel: (level) => levels.push(level),
    fetchImpl: impl,
    createRoom: async () => room.room,
    createLevelMeter: () => null,
    ...overrides,
  }).start(ctx, io);

  await settle();
  return { session, io: log, room, posts, states, lines, videos, levels };
}

/** The tutor arrives and starts talking. */
function tutorJoins(room: FakeRoom): RemoteMediaTrack {
  const track = fakeTrack('audio');
  room.fire('trackSubscribed', track);
  return track;
}

const controlPacket = (message: Parameters<typeof encodeTutorControl>[0]): Uint8Array =>
  encodeTutorControl(message);

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('doubtRoomName', () => {
  it('is one room per student per lesson', () => {
    expect(doubtRoomName('l-7', 'student-42')).toBe('doubt-l-7-student-42');
    expect(doubtRoomName('l-7', 'student-9')).not.toBe(doubtRoomName('l-7', 'student-42'));
  });
});

describe('dispatchBrief', () => {
  const brief = dispatchBrief(ctx, {
    identity: IDENTITY,
    name: 'Aarav',
    subject: 'Science',
    title: 'How the heart works',
    student: { klass: 8, mastery: 0.4 },
  });

  it('renames the two fields persona reads under different names', () => {
    expect(brief.onScreen).toEqual(ctx.visibleElementIds);
    expect(brief.recallableBeats).toEqual(ctx.recentBeats);
  });

  it('carries the moment, the transcript and who is asking', () => {
    expect(brief.lessonId).toBe(ctx.lessonId);
    expect(brief.beatId).toBe(ctx.beatId);
    expect(brief.beatTopic).toBe(ctx.beatTopic);
    expect(brief.transcriptSoFar).toBe(ctx.transcriptSoFar);
    expect(brief.studentIdentity).toBe(IDENTITY);
    expect(brief.studentName).toBe('Aarav');
    expect(brief.student).toEqual({ klass: 8, mastery: 0.4 });
  });

  it('copies the arrays rather than sharing the lesson document', () => {
    brief.onScreen.push('b_forged');
    expect(ctx.visibleElementIds).toEqual(['b_ra', 'b_la']);
  });

  it('omits the optional fields it was not given', () => {
    const bare = dispatchBrief(ctx, { identity: IDENTITY, student: { klass: 6 } });
    expect('studentName' in bare).toBe(false);
    expect('subject' in bare).toBe(false);
    expect('title' in bare).toBe(false);
  });
});

describe('agentLiveState', () => {
  it('treats thinking as speaking', () => {
    // The answer has already begun from the student's side; flicking back to
    // "listening" between her last word and her first sound reads as a tutor
    // who lost interest.
    expect(agentLiveState('thinking')).toBe('speaking');
    expect(agentLiveState('speaking')).toBe('speaking');
  });

  it('passes listening straight through', () => {
    expect(agentLiveState('listening')).toBe('listening');
  });

  it('leaves the UI alone for anything it does not model', () => {
    expect(agentLiveState('idle')).toBeNull();
    expect(agentLiveState('initializing')).toBeNull();
    expect(agentLiveState('daydreaming')).toBeNull();
    expect(agentLiveState(undefined)).toBeNull();
  });
});

describe('createLiveKitAgent — the class must never get stuck', () => {
  it('hands the class back when the token server will not answer', async () => {
    const { io, room, states } = await start({}, { '/token': { ok: false, status: 502, body: {} } });

    expect(io.said).toHaveLength(1);
    expect(io.dones).toBe(1);
    expect(states.at(-1)).toBe('error');
    // No token, so no room was ever joined.
    expect(room.connects).toHaveLength(0);
  });

  it('hands the class back when the microphone is refused', async () => {
    const { io, room, states } = await start({}, undefined, (fake) => {
      fake.refuseMic = true;
    });

    expect(io.said).toHaveLength(1);
    expect(io.said[0]).toContain('microphone');
    expect(io.dones).toBe(1);
    expect(states.at(-1)).toBe('error');
    // Joined, then left again — the room is never held open on a dead session.
    expect(room.connects).toHaveLength(1);
    expect(room.disconnects).toBe(1);
  });

  it('hands the class back when the dispatch is refused', async () => {
    const { io } = await start({}, { '/token': TOKEN_OK, '/doubt': { ok: false, status: 500, body: {} } });

    expect(io.said).toHaveLength(1);
    expect(io.dones).toBe(1);
  });

  it('hands the class back when the tutor never joins', async () => {
    const { io, room } = await start();
    expect(io.dones).toBe(0); // still waiting for her

    await vi.advanceTimersByTimeAsync(AGENT_JOIN_TIMEOUT_MS);
    await settle();

    expect(io.said).toHaveLength(1);
    expect(io.dones).toBe(1);
    expect(room.disconnects).toBe(1);
  });

  it('does not hand back once the tutor is actually in the room', async () => {
    const { io, room, states } = await start();
    tutorJoins(room);

    await vi.advanceTimersByTimeAsync(AGENT_JOIN_TIMEOUT_MS * 2);
    await settle();

    expect(io.said).toHaveLength(0);
    expect(io.dones).toBe(0);
    expect(states).toContain('listening');
  });

  it('says one line and hands back exactly once when the room drops mid-doubt', async () => {
    const { io, room, states } = await start();
    tutorJoins(room);

    room.fire('disconnected');
    await settle();
    // Our own teardown disconnects too; that must not speak a second apology.
    room.fire('disconnected');
    await settle();

    expect(io.said).toHaveLength(1);
    expect(io.said[0]).toContain('cut off');
    expect(io.dones).toBe(1);
    expect(states.at(-1)).toBe('error');
  });

  it('stops the timers it started when it hands back', async () => {
    const { io } = await start();
    await vi.advanceTimersByTimeAsync(AGENT_JOIN_TIMEOUT_MS);
    await settle();
    expect(io.dones).toBe(1);

    // A poll loop still ticking after the hand-back would keep talking to a
    // room nobody is in.
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(io.dones).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createLiveKitAgent — the room control messages', () => {
  const deliver = async (room: FakeRoom, payload: Uint8Array, topic = TUTOR_CONTROL_TOPIC) => {
    room.fire('dataReceived', payload, undefined, undefined, topic);
    await settle();
  };

  it('moves the canvas to a moment the student has already seen', async () => {
    const { io, room } = await start();
    tutorJoins(room);

    await deliver(room, controlPacket({ type: 'recall_moment', beatId: 'pump' }));

    expect(io.recalled).toEqual(['pump']);
  });

  it('drops a beat id the student has never seen', async () => {
    const { io, room } = await start();
    tutorJoins(room);

    await deliver(room, controlPacket({ type: 'recall_moment', beatId: 'aorta-later-in-lesson' }));

    // The worker validates too. Both validate, because a bad id either blanks
    // the board or shows a part of the lesson that has not happened yet.
    expect(io.recalled).toEqual([]);
    expect(io.dones).toBe(0);
  });

  it('ignores packets on any other topic', async () => {
    const { io, room } = await start();
    tutorJoins(room);

    // LiveKit publishes its own transcriptions on lk.transcription.
    await deliver(room, controlPacket({ type: 'end_doubt', reason: 'resolved' }), 'lk.transcription');

    expect(io.dones).toBe(0);
  });

  it('ignores a payload that is not one of ours', async () => {
    const { io, room } = await start();
    tutorJoins(room);

    await deliver(room, new TextEncoder().encode('not json at all'));

    expect(io.dones).toBe(0);
    expect(io.said).toHaveLength(0);
  });

  it('hands back in silence when the doubt resolved', async () => {
    const { io, room } = await start();
    tutorJoins(room);

    await deliver(room, controlPacket({ type: 'end_doubt', reason: 'resolved' }));

    // She has already spoken her own closing line; a second one would be the
    // seam becoming audible.
    expect(io.said).toHaveLength(0);
    expect(io.dones).toBe(1);
    expect(room.disconnects).toBe(1);
  });

  it('says one line when the doubt failed', async () => {
    const { io, room } = await start();
    tutorJoins(room);

    // 'failed' means she said nothing at all; a student cannot be left
    // wondering why the class stopped.
    await deliver(room, controlPacket({ type: 'end_doubt', reason: 'failed' }));

    expect(io.said).toHaveLength(1);
    expect(io.dones).toBe(1);
  });

  it('hands back only once however many end messages arrive', async () => {
    const { io, room } = await start();
    tutorJoins(room);

    await deliver(room, controlPacket({ type: 'end_doubt', reason: 'resolved' }));
    await deliver(room, controlPacket({ type: 'end_doubt', reason: 'failed' }));

    expect(io.dones).toBe(1);
    expect(io.said).toHaveLength(0);
  });
});

describe('createLiveKitAgent — after stop()', () => {
  it('makes no io call at all, however many messages keep arriving', async () => {
    const { session, io, room, states, lines } = await start();
    tutorJoins(room);
    const statesBefore = states.length;
    const linesBefore = lines.length;

    session.stop();

    room.fire('dataReceived', controlPacket({ type: 'recall_moment', beatId: 'pump' }), undefined, undefined, TUTOR_CONTROL_TOPIC);
    room.fire('dataReceived', controlPacket({ type: 'end_doubt', reason: 'failed' }), undefined, undefined, TUTOR_CONTROL_TOPIC);
    room.fire('disconnected');
    room.transcribe('tutor-bot', fakeReader(['still talking'], { 'lk.segment_id': 's9' }));
    session.sendUserText('are you there?');
    await vi.advanceTimersByTimeAsync(AGENT_JOIN_TIMEOUT_MS * 2);
    await settle();

    expect(io.said).toHaveLength(0);
    expect(io.recalled).toEqual([]);
    expect(io.dones).toBe(0);
    expect(states).toHaveLength(statesBefore);
    expect(lines).toHaveLength(linesBefore);
    expect(room.sent).toHaveLength(0);
  });

  it('leaves the room and takes the tutor audio element out of the page', async () => {
    const { session, room } = await start();
    tutorJoins(room);
    expect(document.querySelectorAll('audio')).toHaveLength(1);

    session.stop();
    await settle();

    expect(document.querySelectorAll('audio')).toHaveLength(0);
    expect(room.disconnects).toBe(1);
    expect(room.handlerTopics()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createLiveKitAgent — the microphone', () => {
  it('mutes the published track and never unpublishes it', async () => {
    let muted = false;
    const { room } = await start({ isMuted: () => muted });

    expect(room.mic.enables).toEqual([true]);
    expect(room.mic.publishes).toBe(1);

    muted = true;
    await vi.advanceTimersByTimeAsync(MIC_POLL_MS);
    await settle();

    // Unpublishing would drop the track the session's voice activity detection
    // listens to, and the next question would go unanswered. So: still one
    // publication, now muted.
    expect(room.mic.enables).toEqual([true, false]);
    expect(room.mic.published).toBe(true);
    expect(room.mic.publishes).toBe(1);

    muted = false;
    await vi.advanceTimersByTimeAsync(MIC_POLL_MS);
    await settle();

    expect(room.mic.enables).toEqual([true, false, true]);
    expect(room.mic.publishes).toBe(1);
  });

  it('does not touch the track while the mute switch has not moved', async () => {
    const { room } = await start({ isMuted: () => false });

    await vi.advanceTimersByTimeAsync(MIC_POLL_MS * 10);
    await settle();

    expect(room.mic.enables).toEqual([true]);
  });

  it('reports the level while listening and zero while muted', async () => {
    let muted = false;
    const { levels } = await start({
      isMuted: () => muted,
      createLevelMeter: () => ({ read: () => 0.5, close: () => undefined }),
    });

    await vi.advanceTimersByTimeAsync(MIC_POLL_MS);
    await settle();
    expect(levels.at(-1)).toBe(0.5);

    muted = true;
    await vi.advanceTimersByTimeAsync(MIC_POLL_MS);
    await settle();
    expect(levels.at(-1)).toBe(0);
  });
});

describe('createLiveKitAgent — the room', () => {
  it('joins with the token it was given, then dispatches the tutor', async () => {
    const { room, posts } = await start();

    expect(room.connects).toEqual([{ url: 'ws://127.0.0.1:7880', token: 'a.join.jwt' }]);
    // Order matters: dispatched before the student is connected, she speaks her
    // opening line to an empty room.
    expect(posts.map((post) => post.path)).toEqual(['/token', '/doubt']);
    expect(posts[1].body).toEqual({ room: ROOM, brief: dispatchBrief(ctx, { identity: IDENTITY, name: 'Aarav', student: { klass: 8 } }) });
  });

  it('puts the tutor audio element into the page, or nothing is heard', async () => {
    const { room, states } = await start();
    tutorJoins(room);

    // attach() with no argument builds a DETACHED element; appending it is what
    // makes her audible.
    expect(document.querySelectorAll('audio')).toHaveLength(1);
    expect(states.at(-1)).toBe('listening');
    expect(room.disconnects).toBe(0);
  });

  it('adopts a tutor who was already in the room when we joined', async () => {
    // RoomEvent.TrackSubscribed does not fire for participants already present,
    // which is exactly where a reconnect inside a doubt lands.
    const track = fakeTrack('audio');
    const { io, states } = await start({}, undefined, (fake) => {
      fake.participants.set('tutor-bot', {
        getTrackPublications: () => [{ track }],
        attributes: { 'lk.agent.state': 'listening' },
      });
    });

    expect(states.at(-1)).toBe('listening');

    await vi.advanceTimersByTimeAsync(AGENT_JOIN_TIMEOUT_MS);
    await settle();
    expect(io.dones).toBe(0);
  });

  it('follows the tutor between listening and speaking', async () => {
    const { room, states } = await start();
    tutorJoins(room);

    room.fire('participantAttributesChanged', { 'lk.agent.state': 'speaking' });
    expect(states.at(-1)).toBe('speaking');

    room.fire('participantAttributesChanged', { 'lk.agent.state': 'listening' });
    expect(states.at(-1)).toBe('listening');

    // An attribute change that says nothing about her state leaves it alone.
    const before = states.length;
    room.fire('participantAttributesChanged', { 'lk.something.else': 'x' });
    expect(states).toHaveLength(before);
  });

  it('hands the classroom the tutor video when one ever exists', async () => {
    const { room, videos } = await start();
    const video = fakeTrack('video');
    room.fire('trackSubscribed', video);

    expect(videos).toHaveLength(1);
    const handle = videos[0];
    expect(handle).not.toBeNull();

    // The classroom owns the element, so attaching must not create one.
    const element = document.createElement('video');
    handle?.attach(element);
    expect(video.detach()).toEqual([element]);

    room.fire('trackUnsubscribed', video);
    expect(videos.at(-1)).toBeNull();
  });

  it('never fires the video callback while there is no avatar', async () => {
    const { room, videos } = await start();
    tutorJoins(room);
    expect(videos).toEqual([]);
  });
});

describe('createLiveKitAgent — captions', () => {
  it('labels each side of the conversation by who published it', async () => {
    const { room, lines } = await start();
    tutorJoins(room);

    room.transcribe(IDENTITY, fakeReader(['why', 'why four'], { 'lk.segment_id': 's1' }));
    await settle();
    room.transcribe('tutor-bot', fakeReader(['Because'], { 'lk.segment_id': 's2' }));
    await settle();

    expect(lines.map((line) => line.role)).toEqual(['student', 'student', 'tutor']);
  });

  it('grows a line in place and closes it when the segment is final', async () => {
    const { room, lines } = await start();
    tutorJoins(room);

    room.transcribe(
      'tutor-bot',
      fakeReader(['Because the', 'Because the heart'], {
        'lk.segment_id': 's1',
        'lk.transcription_final': 'true',
      }),
    );
    await settle();

    expect(lines).toEqual([
      { role: 'tutor', text: 'Because the', final: false },
      { role: 'tutor', text: 'Because the heart', final: false },
      { role: 'tutor', text: 'Because the heart', final: true },
    ]);
  });

  it('closes an unfinalised line when the next utterance starts', async () => {
    // The delta form of the stream is opened before anyone knows it is the last
    // one, so its attributes say final:false and the next segment is what ends
    // it. Without this the new utterance would overwrite the old one in place.
    const { room, lines } = await start();
    tutorJoins(room);

    room.transcribe('tutor-bot', fakeReader(['One'], { 'lk.segment_id': 's1' }));
    await settle();
    room.transcribe('tutor-bot', fakeReader(['Two'], { 'lk.segment_id': 's2' }));
    await settle();

    expect(lines).toEqual([
      { role: 'tutor', text: 'One', final: false },
      { role: 'tutor', text: 'One', final: true },
      { role: 'tutor', text: 'Two', final: false },
    ]);
  });
});

describe('createLiveKitAgent — typed questions', () => {
  it('sends the text to the tutor and captions it', async () => {
    const { session, room, lines } = await start();
    tutorJoins(room);

    session.sendUserText('why four and not two?');
    await settle();

    expect(room.sent).toEqual([{ text: 'why four and not two?', topic: 'lk.chat' }]);
    expect(lines.at(-1)).toEqual({
      role: 'student',
      text: 'why four and not two?',
      final: true,
    });
  });

  it('drops text typed before the tutor is in the room', async () => {
    const { session, room } = await start();

    session.sendUserText('hello?');
    await settle();

    expect(room.sent).toHaveLength(0);
  });
});
