import { AccessToken, TrackSource, type VideoGrant } from 'livekit-server-sdk';
import type { TokenServerConfig } from './config.ts';
import type { TokenRequest, TokenResponse } from './protocol.ts';

/**
 * THE JOIN TOKEN — the only reason this process exists.
 *
 * A LiveKit token is signed with the API secret. If the browser could mint its
 * own, the secret would be in the bundle, and anyone could join any room as
 * anyone. So the browser asks; this file signs.
 */

/**
 * Long enough for one doubt including a dropped-connection reconnect, short
 * enough that a token copied out of devtools is worthless by the time anyone
 * uses it. The browser asks for a fresh one each time a hand goes up.
 */
export const STUDENT_TOKEN_TTL_SEC = 15 * 60;

/**
 * The narrowest grant that still works for a doubt.
 *
 * A student needs to be heard (microphone), to hear (subscribe), and to send
 * the small control messages the doubt UI uses (data). Everything else is
 * refused by omission or explicitly:
 *
 *  - `canPublishSources` supersedes `canPublish`, so the microphone is the only
 *    track that can ever be published — no camera, no screen share from a
 *    classroom.
 *  - `canUpdateOwnMetadata` stays false: the brief is carried by the dispatch,
 *    and a client that can rewrite its own metadata can lie about who it is.
 *  - no `roomCreate`, no `roomAdmin`, no `roomList` — a token for one room is
 *    a key to one room.
 */
export function studentGrant(room: string): VideoGrant {
  return {
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: true,
    canUpdateOwnMetadata: false,
    hidden: false,
  };
}

/**
 * Sign one join token.
 *
 * No participant metadata and no attributes are baked in: the beat changes
 * with every raised hand, and anything baked into a token is frozen until the
 * token is reissued. The lesson brief travels with the dispatch instead.
 */
export async function mintStudentToken(
  config: TokenServerConfig,
  request: TokenRequest,
): Promise<TokenResponse> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: request.identity,
    name: request.name,
    ttl: STUDENT_TOKEN_TTL_SEC,
  });
  token.addGrant(studentGrant(request.room));

  return {
    url: config.livekitUrl,
    token: await token.toJwt(),
    room: request.room,
    identity: request.identity,
    expiresInSec: STUDENT_TOKEN_TTL_SEC,
  };
}
