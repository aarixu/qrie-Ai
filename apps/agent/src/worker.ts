import { fileURLToPath } from 'node:url';
import {
  Agent,
  AgentSession,
  AgentSessionEventTypes,
  ServerOptions,
  cli,
  defineAgent,
  log,
  tool,
  type JobContext,
} from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import type { RemoteParticipant, Room } from '@livekit/rtc-node';
import { z } from 'zod';
import { loadLocalEnv, readGoogleApiKey } from './config.ts';
import {
  END_DOUBT,
  RECALL_MOMENT,
  TUTOR_CONTROL_TOPIC,
  encodeTutorControl,
  type TutorControlMessage,
} from './messages.ts';
import { AGENT_NAME, parseDoubtBrief, type DoubtBrief } from './protocol.ts';
import { enableWorkspaceResolution } from './workspaceResolve.ts';

/**
 * THE LIVE TUTOR — the second half of the seam.
 *
 * A student is watching a recording. They tap the raised hand, the recording
 * pauses, and this worker is dispatched into the room they are already sitting
 * in. She greets them, answers by voice, can put an earlier moment of the class
 * back on the board, and hands the room back to the recording. If it worked,
 * the student never noticed a handover happened at all.
 *
 * This file is wiring. The words come from @ai-tutor/persona (via ./brief.ts),
 * the wire format from ./messages.ts, the briefing from ./protocol.ts — all of
 * which are testable without a LiveKit server. What is left here is the parts
 * that only exist when a real room exists.
 */

loadLocalEnv();
enableWorkspaceResolution();

/**
 * ./brief.ts reaches @ai-tutor/persona, and that package's own imports need the
 * resolver installed on the line above — which a static import at the top of
 * this file would run too late for, because ESM resolves the whole import graph
 * before any of it executes. This is the one import in the service that has to
 * be dynamic, and this is why.
 */
const { doubtInstructions, findRecallable, recallConfirmation, recallRejection } = await import(
  './brief.ts'
);

/**
 * Read here rather than left to the plugin. The plugin's own lookup does not
 * throw when the key is missing: it warns, the websocket dies, and the student
 * meets a tutor who joins and then says nothing at all.
 */
const googleApiKey = readGoogleApiKey(process.env);

/**
 * The one live model that works for this handoff, established by running all
 * three candidates on our key:
 *  - any id containing '3.1' disables mid-session context updates in the
 *    plugin, and `generateReply()` THROWS on it — but our handoff opens with
 *    her greeting the student, which is a generateReply.
 *  - 'gemini-2.5-flash-native-audio-preview-12-2025' answers
 *    "CONTENT_TYPE_AUDIO is not supported".
 * This one returns real audio frames. Do not "upgrade" it without running it.
 */
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-latest';

/**
 * THE SAME VOICE AS THE RECORDING. tools/record-class narrates every lesson
 * with Sulafat (the one voice Google labels Warm), and the entire illusion —
 * that the recording and the live tutor are one teacher — collapses the moment
 * these two drift apart. Change both or neither.
 */
const TUTOR_VOICE = 'Sulafat';

/**
 * How long the agent waits for the student who supposedly raised a hand. They
 * are normally already in the room — the browser dispatches only once it is
 * connected — so this is the fallback for a dispatch that raced a disconnect.
 * Waiting forever would pin a child process to a room with nobody in it.
 */
const STUDENT_WAIT_MS = 30_000;

/**
 * Push a control message to the browser.
 *
 * `destination_identities` is SNAKE_CASE on the agent side (@livekit/rtc-node)
 * and camelCase in the browser (livekit-client). Spelled the browser's way here
 * it is silently dropped as an unknown property and the message broadcasts to
 * the whole room — harmless with one student, a privacy bug the day a room has
 * two.
 */
async function publish(
  room: Room,
  message: TutorControlMessage,
  toIdentity: string | null,
): Promise<void> {
  const local = room.localParticipant;
  if (local === undefined) return;

  await local.publishData(encodeTutorControl(message), {
    reliable: true,
    topic: TUTOR_CONTROL_TOPIC,
    destination_identities: toIdentity === null ? [] : [toIdentity],
  });
}

/** The student, or null if they never arrived or the room went away. */
async function waitForStudent(ctx: JobContext, identity: string): Promise<RemoteParticipant | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const givenUp = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), STUDENT_WAIT_MS);
  });

  try {
    return await Promise.race([ctx.waitForParticipant(identity), givenUp]);
  } catch {
    // waitForParticipant rejects when the room disconnects underneath it.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The two tools, named by the same constants as the messages they send, so a
 * tool call and the browser's switch statement can never disagree about what
 * an event is called.
 *
 * `onHandBack` tells the caller that this ending was deliberate — see the
 * session close handler in `entry`.
 */
function tutorTools(ctx: JobContext, brief: DoubtBrief, onHandBack: () => void) {
  return {
    [RECALL_MOMENT]: tool({
      description:
        'Bring an earlier moment of this class back onto the board so the student can look at it while you explain. Use it whenever a picture from earlier would answer the doubt faster than words.',
      parameters: z.object({
        beatId: z
          .string()
          .describe('The id of the moment to show. Must be one listed in your briefing.'),
      }),
      execute: async ({ beatId }) => {
        const beat = findRecallable(brief, beatId);
        if (beat === null) {
          // The canvas is NOT touched. An invented id would either blank the
          // board or show a later part of the lesson and spoil it, so the model
          // is corrected instead and the student sees nothing happen.
          return recallRejection(brief, beatId);
        }
        await publish(ctx.room, { type: RECALL_MOMENT, beatId: beat.id }, brief.studentIdentity);
        return recallConfirmation(beat);
      },
    }),

    [END_DOUBT]: tool({
      description:
        'The doubt is resolved and the recorded class should carry on. Say your one closing line first, then call this — the recording resumes immediately afterwards.',
      execute: async (_args, { ctx: runCtx }) => {
        // Let her closing sentence finish playing. Resuming the recording over
        // the top of it is exactly the seam this product exists to hide.
        await runCtx.waitForPlayout();
        onHandBack();
        await publish(ctx.room, { type: END_DOUBT, reason: 'resolved' }, brief.studentIdentity);
        ctx.shutdown('doubt resolved');
        return 'Handed back to the recorded class.';
      },
    }),
  };
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const logger = log();

    // Connect first: the briefing has to be read and the agent built before
    // anyone can be greeted, and every millisecond here is silence in a room
    // where the recording has already stopped.
    await ctx.connect();

    const brief = parseDoubtBrief(ctx.job.metadata);
    if (brief === null) {
      // We do not know who to talk to, or which class they are in, so there is
      // nobody to be a tutor to. Hand the room straight back rather than invent
      // a student: a paused recording with no explanation is the one outcome
      // worse than no live tutor. Broadcast, because the identity we would
      // normally target is exactly what we failed to read.
      logger.error({ jobId: ctx.job.id }, 'dispatch metadata is not a usable doubt brief');
      await publish(ctx.room, { type: END_DOUBT, reason: 'failed' }, null);
      ctx.shutdown('unusable dispatch metadata');
      return;
    }

    const student = await waitForStudent(ctx, brief.studentIdentity);
    if (student === null) {
      logger.warn({ identity: brief.studentIdentity }, 'student never joined; leaving the room');
      ctx.shutdown('student not present');
      return;
    }

    logger.info(
      { lessonId: brief.lessonId, beatId: brief.beatId, identity: student.identity },
      'taking over the room',
    );

    // Set only by the end_doubt tool: it is the difference between "she
    // finished" and "something broke", and the browser says a different line
    // for each.
    let handedBack = false;

    const agent = Agent.create({
      // Every word of this comes from @ai-tutor/persona. Nothing in this
      // service writes tutor prose — that is what the package is for.
      instructions: doubtInstructions(brief),
      tools: tutorTools(ctx, brief, () => {
        handedBack = true;
      }),
      onEnter: ({ session: live }) => {
        // She speaks first. The moment in the prompt is DOUBT_OPENING, whose
        // guidance is "invite the question and stop", so no extra instructions
        // are needed — and none are given, because an instruction written here
        // would be a second, competing persona.
        live.generateReply();
      },
    });

    const session = new AgentSession({
      llm: new google.realtime.RealtimeModel({
        model: LIVE_MODEL,
        voice: TUTOR_VOICE,
        apiKey: googleApiKey,
        // No `language` either. Setting one is how you would normally ask for
        // Indian-accented English, but this model refuses a language code
        // outright — "Unsupported language code 'en-IN'", and the socket closes
        // before she says a word. Native-audio models take their language from
        // the conversation, and the persona prompt is English.
        // No `instructions` here on purpose: the framework pushes the agent's
        // instructions into the realtime session when it starts, and a second
        // copy in the model config is a second thing to keep in step.
      }),
      // Gemini Live runs its own server-side voice activity detection and
      // barge-in. The framework's bundled silero VAD would be a second opinion
      // we never consult, plus a native module loaded into every forked job.
      vad: null,
    });

    /**
     * THE CLASS MUST NEVER GET STUCK. Any ending other than the tutor handing
     * back deliberately — a refused API key, a dead websocket, the model
     * closing mid-answer — leaves a student sitting in front of a paused
     * recording. Every one of those paths arrives here, and every one of them
     * resumes the class.
     */
    session.on(AgentSessionEventTypes.Close, (event) => {
      if (handedBack) return;
      logger.warn({ reason: event.reason, error: event.error }, 'doubt ended without a hand-back');
      publish(ctx.room, { type: END_DOUBT, reason: 'failed' }, brief.studentIdentity).catch(
        (error: unknown) => {
          // The room is already gone. The browser's own disconnect handling is
          // the last line of defence, and it exists for exactly this.
          logger.warn({ error }, 'could not tell the browser the doubt had failed');
        },
      );
    });

    ctx.addShutdownCallback(async () => {
      logger.info({ lessonId: brief.lessonId, usage: session.usage }, 'doubt session ended');
    });

    // ---------------------------------------------------------------------
    // AVATAR SLOT — deliberately empty, and deliberately documented.
    //
    // A talking avatar attaches here, immediately before session.start():
    //
    //   const avatar = new <plugin>.AvatarSession({ ...avatar id/config... });
    //   await avatar.start(session, ctx.room);
    //
    // Two rules decide whether it works:
    //  1. START IT BEFORE THE AGENT SESSION. The avatar service takes over the
    //     session's audio output; started afterwards, the first sentence has
    //     already gone out of the agent's own track and the lips are behind
    //     from the first word.
    //  2. IT REPLACES THE AGENT'S AUDIO TRACK. The avatar joins as a SECOND
    //     participant and republishes her voice in lipsync with the video, so
    //     the browser must render the avatar participant, not the agent one.
    //     Subscribe to both and the student hears her twice, slightly apart.
    //
    // No avatar dependency is installed. See recon-2 for the plugins and what
    // they cost per minute before adding one.
    // ---------------------------------------------------------------------

    await session.start({
      agent,
      room: ctx.room,
      inputOptions: {
        audioEnabled: true,
        textEnabled: true,
        // Linked explicitly rather than "the first participant": the avatar
        // slot above puts a second participant in this room.
        participantIdentity: student.identity,
        closeOnDisconnect: true,
        // The room outlives the doubt — the student stays in it and may raise
        // a hand again on the next beat.
        deleteRoomOnClose: false,
      },
      outputOptions: {
        // Captions for the doubt UI. They stay inside the room; nothing here
        // is uploaded (see `record` below).
        transcriptionEnabled: true,
        audioEnabled: true,
      },
      // OFF, EXPLICITLY. Every recording category defaults to ON in 1.7 —
      // session audio, transcript, traces and logs are uploaded unless you say
      // otherwise. Our students are children between 11 and 18. Their voices
      // and their doubts do not leave the room they were spoken in.
      record: false,
    });
  },
});

// This file is both the agent module and its own launcher: `node src/worker.ts
// dev` runs the worker, and the framework re-imports this same path inside each
// forked job to read the DEFAULT EXPORT above. A named export would boot
// cleanly and then fail on the first raised hand.
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    // Setting agentName turns OFF automatic dispatch. Without it this worker
    // would join every room in the project — meaning every student watching a
    // recording would have a live Gemini session burning tokens beside them.
    // With it, she arrives only when the token server dispatches her, which
    // only happens when a hand goes up.
    agentName: AGENT_NAME,
  }),
);
