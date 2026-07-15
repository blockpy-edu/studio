/**
 * @blockpy/reader - reading assignments: markdown/HTML content, runnable
 * code blocks, load⇒correct completion, and engagement telemetry
 * (spec §11.2).
 */
export {
  Reader,
  LOG_TIME_RATE,
  VIDEO_EVENTS,
  type MarkReadResponse,
  type ReaderAssignment,
  type ReaderLoadResult,
  type ReaderProps,
  type ReaderSubmission,
  type ReaderTimeLimitInfo,
} from './Reader';
export { renderReadingMarkdown, splitFenceInfo, type ReaderRenderEnv } from './markdown';
export {
  VOICE_CHOICE_KEY,
  getBestVoice,
  parseReaderSettings,
  rememberVoiceChoice,
  type ReaderSettings,
} from './settings';
export { RunnableBlock, collectRunnableSlots, type RunnableSlot } from './Runnable';
