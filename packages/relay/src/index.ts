// Public surface of @ai-tutor/relay — the five relays, portable.
//
// The app talks to /api/llm, /api/speech, /api/hear, /api/icons and
// /api/class. Today those are dev-only vite plugins holding the OpenRouter
// key on a laptop, which is exactly why nothing can be deployed. This package
// is that logic with no server and no cloud SDK around it, so the decisions
// are testable and the adapter for any particular host stays trivial.
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
} from './relays';

export { readBody, sendRelayResponse, toRelayRequest } from './node';
