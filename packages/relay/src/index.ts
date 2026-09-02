// Public surface of @ai-tutor/relay — the five relays, portable, with the
// lock and the meter that make them safe to expose.
//
// The app talks to /api/llm, /api/speech, /api/hear, /api/icons and
// /api/class. Those used to be dev-only vite plugins holding the OpenRouter
// key on a laptop, which is exactly why nothing could be deployed. This
// package is that logic with no server and no cloud SDK around it, so the
// decisions are testable and each host's adapter stays trivial: node.ts for
// the vite dev server and the Node token server, web.ts for the Supabase Edge
// Function.
export {
  CAP_MAX_TOKENS,
  DEFAULT_HEAR_MODEL,
  DEFAULT_SPEECH_MODEL,
  capMaxTokens,
  checkSavedClass,
  fail,
  hearRelay,
  llmRelay,
  speechRelay,
  type RelayRequest,
  type RelayResponse,
  type SavedClass,
  type UpstreamCall,
} from './relays.ts';

export {
  bearerFrom,
  cacheVerifier,
  createSupabaseVerifier,
  type Verified,
  type Verifier,
  type VerifyResult,
} from './auth.ts';

export {
  REQUESTS_PER_MINUTE,
  UNITS,
  UNITS_PER_DAY,
  admit,
  createMemoryLedger,
  createSupabaseLedger,
  type Admission,
  type ClaimResult,
  type Gate,
  type Ledger,
  type RelayName,
} from './gate.ts';

export { TICKET_TTL_MS, mintTicket, readTicket, type Ticket } from './ticket.ts';

export { handleRelay, handleTicket, relayFor, type HandlerDeps } from './handler.ts';

export { readBody, sendRelayResponse, toRelayRequest } from './node.ts';

export {
  toRelayRequest as toRelayRequestFromWeb,
  toResponse,
  transcribeViaFormData,
} from './web.ts';
