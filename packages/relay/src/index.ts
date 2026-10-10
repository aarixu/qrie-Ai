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
  HEAR_LANGUAGE,
  MAX_HEAR_BYTES,
  DEFAULT_SPEECH_MODEL,
  DEFAULT_SPEECH_VOICE,
  capMaxTokens,
  checkSavedClass,
  fail,
  isShortText,
  hearRelay,
  llmRelay,
  speechRelay,
  type HeardAudio,
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
  HEARD_BYTES_PER_SECOND,
  REQUESTS_PER_MINUTE,
  UNITS,
  UNITS_PER_DAY,
  UNITS_PER_DAY_PROJECT,
  admit,
  admitFree,
  createMemoryLedger,
  createSupabaseLedger,
  unitsFor,
  type Admission,
  type ClaimResult,
  type FreeRoute,
  type Gate,
  type Ledger,
  type Price,
  type RelayName,
} from './gate.ts';

// The wave-2 route families: a child's report reaching a person, the prep
// lock finally wired, and enrolment as a DPDP consent artifact. The types
// here ARE the contract Wave 3 codes against.
export {
  MAX_REPORT_BYTES,
  MAX_REPORT_NOTE_CHARS,
  createMemoryReportStore,
  createSupabaseReportStore,
  isUuid,
  readStudentReport,
  sendReportAlert,
  type ReportAlert,
  type ReportKind,
  type ReportPlatform,
  type ReportStore,
  type StudentReport,
} from './report.ts';

// Plan 5: a distress flag carried to the server, with no words.
export {
  MAX_FLAG_BYTES,
  createMemorySafetyEventStore,
  createSupabaseSafetyEventStore,
  handleSafetyFlag,
  readSafetyFlag,
  type SafetyEventStore,
  type SafetyFlag,
} from './safetyFlag.ts';

export {
  MAX_CONTROL_BYTES,
  MAX_PREP_STATE_REFS,
  MEMORY_PREP_CEILING,
  PREP_LOCK_TTL_SECONDS,
  createMemoryPrepLocks,
  createSupabasePrepLocks,
  isTopicRef,
  type PrepLockAnswer,
  type PrepLocks,
  type PrepTopicState,
} from './prep.ts';

export {
  ENROLLED_NEXT,
  OTP_BURST_WINDOW_MINUTES,
  OTP_SENDS_PER_PHONE_BURST,
  OTP_SENDS_PER_DAY_PROJECT,
  OTP_SENDS_PER_PHONE_PER_DAY,
  OTP_SENDS_PER_USER_PER_DAY,
  OTP_TTL_MS,
  createDevOtpProvider,
  createMemoryConsentStore,
  createMemoryOtpGate,
  createSupabaseConsentStore,
  createSupabaseOtpGate,
  isE164,
  type ConsentRow,
  type ConsentStore,
  type EnrollRequest,
  type OtpGate,
  type OtpProvider,
} from './enroll.ts';

export { TICKET_TTL_MS, mintTicket, readTicket, type Ticket } from './ticket.ts';

export {
  createMemoryUsage,
  createSupabaseUsage,
  usageFromClass,
  usageFromHear,
  usageFromOpenRouterLlm,
  usageFromSpeech,
  usageFromVertex,
  type Usage,
  type UsageEvent,
} from './usage.ts';

export { handleRelay, handleTicket, relayFor, routeFor, type HandlerDeps, type RouteName } from './handler.ts';

export { keepClass, publicUrlFor, readSavedClass, type ClassStoreOptions } from './classStore.ts';

export { readBody, sendRelayResponse, toRelayRequest } from './node.ts';

export {
  toRelayRequest as toRelayRequestFromWeb,
  toResponse,
  transcribeViaFormData,
} from './web.ts';
export * from './googleAuth.ts';
export * from './vertex.ts';
