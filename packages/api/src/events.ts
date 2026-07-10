/**
 * The frozen event-identifier registry (spec §14.4, appendix A2 — the
 * review-gate deliverable). Per decision D2, this is the ONE place event
 * identifiers live, with a deprecation system so the research team can
 * track data-quality boundaries in docs and code.
 *
 * Sources: appendix A2 §3 (BlockPy client), §4 (server frontend),
 * §5 (server-fabricated — the studio client must NOT emit those).
 */

export type EventStatus =
  | 'live' // emitted by the studio client
  | 'dead' // existed in legacy source but never fired; do not resurrect
  | 'server'; // fabricated server-side; the client must never emit it

export interface EventDeprecation {
  /** Data before this boundary is untrustworthy or absent. */
  untrustworthyBefore?: 'studio';
  /** Identifier that replaces this one, if renamed. */
  supersededBy?: string;
  note: string;
}

export interface EventDefinition {
  eventType: string;
  /** Fixed category value, if the event always uses one. */
  category?: string;
  status: EventStatus;
  /** What user/system action triggers it. */
  trigger: string;
  /** Shape of the `message` field. */
  message?: string;
  deprecation?: EventDeprecation;
}

export const EVENT_REGISTRY: readonly EventDefinition[] = [
  // --- BlockPy client (editor) — A2 §3 ------------------------------------
  { eventType: 'Compile', status: 'live', trigger: 'Run clicked / console eval begins' },
  {
    eventType: 'Compile.Error',
    status: 'live',
    trigger: 'Syntax error on run or eval',
    message: 'error.toString()',
  },
  {
    eventType: 'Run.Program',
    status: 'live',
    trigger: 'Program completed (or category=ProgramErrorOutput on runtime error)',
    message: 'JSON {inputs, outputs} | error text',
  },
  {
    eventType: 'Intervention',
    status: 'live',
    trigger: 'Feedback presented after a run (extended=true)',
    message: 'JSON {message, syntaxError, runtimeError, unitTests}',
  },
  { eventType: 'X-Evaluate.Program', status: 'live', trigger: 'Console eval succeeded' },
  { eventType: 'X-File.Add', status: 'live', trigger: 'Console eval begins' },
  { eventType: 'X-File.Reset', status: 'live', trigger: 'Reset to starting code' },
  {
    eventType: 'X-View.Change',
    status: 'live',
    trigger: 'Blocks/Split/Text toggle',
    message: 'block | split | text',
  },
  {
    eventType: 'X-Instructions.Change',
    status: 'live',
    trigger: 'Instructor feedback calls set_instructions',
  },
  {
    eventType: 'X-Rating',
    status: 'live',
    trigger: 'Feedback thumbs-up/down',
    message: 'thumbs-up | thumbs-down',
  },
  {
    eventType: 'X-Editor.Paste',
    status: 'live',
    trigger: 'Paste into the text editor',
    message: 'JSON {characters}',
    deprecation: {
      untrustworthyBefore: 'studio',
      note: 'Legacy always logged {characters: 0} (shadowed constant, LD-2a). Real counts only from Studio onward.',
    },
  },
  {
    eventType: 'X-File.Upload',
    status: 'live',
    trigger: 'File uploaded into the editor',
    message: 'full file contents',
  },
  { eventType: 'X-File.Download', status: 'live', trigger: 'File downloaded' },
  {
    eventType: 'X-System.Error',
    category: 'internal',
    status: 'live',
    trigger: 'Internal/timeout error during execution',
  },
  {
    eventType: 'X-Feedback',
    category: 'positive',
    status: 'live',
    trigger: 'Hover on positive-feedback icon',
  },
  { eventType: 'X-Display.Fullscreen.Request', status: 'live', trigger: 'Fullscreen toggle' },
  { eventType: 'X-Display.Fullscreen.Success', status: 'live', trigger: 'Fullscreen granted' },
  { eventType: 'X-Display.Fullscreen.Error', status: 'live', trigger: 'Fullscreen rejected' },
  { eventType: 'X-Display.Fullscreen.Exit', status: 'live', trigger: 'Fullscreen exited' },
  {
    eventType: 'X-IP.Change',
    status: 'live',
    trigger: 'Server-reported IP differs from the last seen',
    message: 'JSON {old, new}',
    deprecation: {
      untrustworthyBefore: 'studio',
      note: 'Legacy detection was dead on the _postRetry path (LD-2c); coverage is complete only from Studio onward.',
    },
  },
  // --- Server frontend (reader/kettle/explain/timers) — A2 §4 -------------
  {
    eventType: 'Resource.View',
    category: 'reading',
    status: 'live',
    trigger: 'Reading visibility/scroll/video telemetry (labels: visibility, read, watch)',
    message:
      'JSON per label (scroll {count,delay,position,height,progress,moved}; video {event,time,duration})',
  },
  {
    eventType: 'timer_error',
    category: 'timer',
    status: 'live',
    trigger: 'Exception in the exam-timer check (lowercase legacy naming preserved)',
  },
  {
    eventType: 'timer_cleared',
    category: 'timer',
    status: 'live',
    trigger: 'Superseded timer cleared (lowercase legacy naming preserved)',
  },
  {
    eventType: 'timer_expired',
    category: 'timer',
    status: 'live',
    trigger: 'Exam time limit reached',
    message: 'JSON {elapsed, remaining, time_limit, start_time}',
  },
  {
    eventType: 'File.Edit',
    category: 'explain',
    status: 'live',
    trigger:
      'ONLY the Explain tool upload emits this client-side; all other File.Edit rows are server-fabricated from save_file (A2 §5)',
  },
  // --- Dead legacy families — never fired; do not resurrect ---------------
  {
    eventType: 'Session.End',
    status: 'dead',
    trigger: 'createEventLogs was never called in legacy',
  },
  {
    eventType: 'engine',
    category: 'on_change',
    status: 'dead',
    trigger: 'Legacy BlockPyEngine.on_change references a pre-rewrite model; no call sites',
  },
  {
    eventType: 'editor',
    status: 'dead',
    trigger: 'Legacy BlockPyToolbar module was never imported',
  },
  // --- Server-fabricated — the studio client must NOT emit these ----------
  {
    eventType: 'Session.Start',
    status: 'server',
    trigger: 'Server logs it on load_assignment; client emission would double-log',
  },
  { eventType: 'File.Create', status: 'server', trigger: 'New submission created server-side' },
  { eventType: 'X-Submission.Get', status: 'server', trigger: 'Grader loads a submission' },
  { eventType: 'X-View.Submission', status: 'server', trigger: 'Grader views a submission page' },
  { eventType: 'X-Image.Save', status: 'server', trigger: 'save_image endpoint' },
  { eventType: 'Submit', status: 'server', trigger: 'Grade pipeline' },
  { eventType: 'X-Submission.LMS', status: 'server', trigger: 'LTI grade passback' },
  { eventType: 'X-Unchanged.LMS', status: 'server', trigger: 'LTI grade passback (no change)' },
  { eventType: 'X-Submission.LMS.Failure', status: 'server', trigger: 'LTI passback failure' },
  {
    eventType: 'X-Submission.LMS.Retry-Failure',
    status: 'server',
    trigger: 'LTI passback retry failure',
  },
  { eventType: 'X-Quiz.Grade.Failure', status: 'server', trigger: 'Quiz grading failure' },
  { eventType: 'X-IP.Blocked', status: 'server', trigger: 'IP-range rejection during passback' },
  { eventType: 'X-Grade.Instructor', status: 'server', trigger: 'Bulk instructor grading upload' },
  { eventType: 'start_timer', status: 'server', trigger: 'Exam timer set via start_assignment' },
  { eventType: 'clear_timer', status: 'server', trigger: 'Exam timer cleared' },
  { eventType: 'extend_time', status: 'server', trigger: 'Instructor extends a time limit' },
  { eventType: 'error', status: 'server', trigger: 'IP-range rejection' },
];

const BY_TYPE = new Map(EVENT_REGISTRY.map((e) => [e.eventType, e]));

export function eventDefinition(eventType: string): EventDefinition | undefined {
  return BY_TYPE.get(eventType);
}

/** May the studio client emit this event type? */
export function clientMayEmit(eventType: string): boolean {
  const def = BY_TYPE.get(eventType);
  // Unknown types are allowed only as X- extensions (spec §14.4).
  if (!def) return eventType.startsWith('X-');
  return def.status === 'live';
}
