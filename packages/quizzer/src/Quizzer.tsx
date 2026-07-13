/**
 * Quiz assignment component (spec §11.3) — port of the server-frontend
 * `<quizzer>` knockout component (frontend/components/quizzes/quizzer.ts +
 * quiz_ui.ts). Grading stays SERVER-side: submit posts updateSubmission
 * `{status: 0, correct: false}` and the server's regrade_if_quiz →
 * process_quiz returns the per-question feedbacks (A3 §5).
 *
 * Pinned legacy semantics:
 *   - attempt lifecycle READY → ATTEMPTING → COMPLETED, derived from
 *     `attempting`/`count` (quiz.ts:158-161); inputs disabled unless
 *     attempting; Start increments count, clears feedback, re-runs pool
 *     selection, saves — but does NOT clear answers (quizzer.ts:184-193).
 *   - pool membership seeded: SEED = submission id, ATTEMPT = id + count,
 *     NONE = 0 (quiz.ts:271-287); instructors can edit the seed.
 *   - attempts left = attemptLimit + mulligans - count (quiz.ts:163-173).
 *   - autosave posts the whole submission JSON on every change while
 *     attempting (quizzer.ts:143-148), text inputs rate-limited 400 ms
 *     (questions.ts:59, 66).
 *   - LD-7: hidden-pool answers persist under the additive `hiddenAnswers`
 *     key instead of being dropped (legacy serialized visible-only).
 *   - The instructor RAW/FORM/QUIZ_EDITOR authoring modes are NOT ported
 *     here (README §11.3.7 scopes the editor out of v1); View-as-Student,
 *     the seed field, pool badges, and question ids are.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AssignmentSurface } from '@blockpy/editor';
import { renderReadingMarkdown } from '@blockpy/reader';
import {
  buildSubmissionDocument,
  defaultAnswer,
  parseQuizInstructions,
  parseQuizSubmission,
  poolByQuestion,
  poolSeed,
  selectVisibleQuestions,
} from './documents';
import { QuestionView, StatusSquare, questionStatusCode } from './QuestionView';
import { QuizEditor } from './editor/QuizEditor';
import type {
  QuestionId,
  QuizInstructions,
  QuizQuestionFeedback,
  QuizSubmission,
  QuizSubmitResponse,
  StudentAnswer,
} from './types';

export type QuizMode = 'READY' | 'ATTEMPTING' | 'COMPLETED';

export interface QuizzerAssignment {
  id: number;
  name: string;
  url: string;
  /** The quiz instructions JSON document. */
  instructions: string;
  /** Assignment settings JSON (time_limit etc.). */
  settings: string;
  /** The checks document (assignment.on_run) — blanked for students,
   *  present for instructors; the quiz editor edits it. */
  onRun?: string;
}

export interface QuizzerSubmission {
  id: number | null;
  /** The quiz submission JSON document. */
  code: string;
  correct: boolean;
  dateStarted: string | null;
  timeLimit: string | null;
}

export interface QuizzerLoadResult {
  assignment: QuizzerAssignment;
  submission: QuizzerSubmission | null;
}

export interface QuizzerProps {
  assignmentId: number;
  loadAssignment: (assignmentId: number) => Promise<QuizzerLoadResult | null>;
  /** saveFile("answer.py", <QuizSubmission JSON>) with the QUIZ's ids. */
  saveAnswer?: (
    assignmentId: number,
    submissionId: number | null,
    code: string,
  ) => Promise<{ success: boolean }>;
  /** updateSubmission {status: 0, correct: false} with the QUIZ's ids. */
  submitQuiz?: (assignmentId: number, submissionId: number | null) => Promise<QuizSubmitResponse>;
  markCorrect?: (assignmentId: number) => void;
  logEvent?: (
    eventType: string,
    category: string,
    label: string,
    message: string,
    filePath: string,
  ) => void;
  downloadUrl?: (assignmentId: number, filename: string) => string;
  isInstructor?: () => boolean;
  /** Reading preamble composition (quiz_ui.ts:194-208; settings.readingId). */
  renderReading?: (readingId: number) => ReactNode;
  /** Resolves a readingId url slug to an assignment id (quizzer.ts:108-110). */
  lookupReadingId?: (url: string) => Promise<number>;
  /** Countdown feed (same contract as the reader's). */
  onTimeLimitInfo?: (info: {
    timeLimit: string | null;
    studentTimeLimit: string | null;
    dateStarted: string | null;
  }) => void;
  /** Persist the two quiz documents (!instructions.md + !on_run.py) —
   *  enables the instructor Quiz Editor view. */
  saveQuizAssignment?: (
    assignmentId: number,
    instructions: string,
    checks: string,
  ) => Promise<{ success: boolean }>;
}

interface LoadedQuiz {
  assignment: QuizzerAssignment;
  submission: QuizzerSubmission | null;
  instructions: QuizInstructions;
  /** The parsed stored document — unknown fields round-trip from here. */
  baseDoc: QuizSubmission;
}

/** quiz.ts:163-168, verbatim strings. */
export function attemptsLeftText(
  attemptLimit: number,
  mulligans: number,
  attemptCount: number,
): string {
  const attempts = attemptLimit + mulligans - attemptCount;
  return attemptLimit === -1
    ? 'infinite attempts left.'
    : attempts < 0
      ? 'no attempts left!'
      : attempts === 1
        ? 'only one attempt left.'
        : `${attempts} attempts left.`;
}

const TEXT_TYPES = new Set([
  'short_answer_question',
  'numerical_question',
  'essay_question',
  'fill_in_multiple_blanks_question',
]);

export function Quizzer(props: QuizzerProps) {
  const [loaded, setLoaded] = useState<LoadedQuiz | null>(null);
  const [answers, setAnswers] = useState<Record<QuestionId, StudentAnswer>>({});
  const [feedback, setFeedback] = useState<Record<QuestionId, QuizQuestionFeedback | null>>({});
  const [attempting, setAttempting] = useState(false);
  const [attemptCount, setAttemptCount] = useState(0);
  const [mulligans, setMulligans] = useState(0);
  const [visible, setVisible] = useState<Set<QuestionId>>(new Set());
  const [seed, setSeed] = useState(0);
  const [asStudent, setAsStudent] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [readingId, setReadingId] = useState<number | null>(null);
  // Instructor-only: whether the collapsed subordinate reading is expanded.
  const [showReading, setShowReading] = useState(true);
  // Instructor view: the visual quiz editor is the normal authoring
  // workflow; "Actual Quiz" shows the student surface.
  const [editorView, setEditorView] = useState<'quiz' | 'editor' | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const propsRef = useRef(props);
  propsRef.current = props;
  const stateRef = useRef({ answers, feedback, visible, attempting, attemptCount, mulligans });
  stateRef.current = { answers, feedback, visible, attempting, attemptCount, mulligans };
  const loadedRef = useRef<LoadedQuiz | null>(null);
  loadedRef.current = loaded;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isInstructor = props.isInstructor?.() ?? false;

  // -- persistence --------------------------------------------------------------

  const buildDocument = useCallback((): QuizSubmission => {
    const current = stateRef.current;
    const base = loadedRef.current?.baseDoc ?? {};
    return buildSubmissionDocument({
      base,
      answers: current.answers,
      feedback: current.feedback,
      visible: current.visible,
      attempting: current.attempting,
      attemptCount: current.attemptCount,
      mulligans: current.mulligans,
    });
  }, []);

  const saveSubmission = useCallback(() => {
    const current = loadedRef.current;
    const { saveAnswer } = propsRef.current;
    if (!current || !saveAnswer) return;
    setIsDirty(true);
    void saveAnswer(
      current.assignment.id,
      current.submission?.id ?? null,
      JSON.stringify(buildDocument(), null, 2),
    )
      .then(() => setIsDirty(false))
      .catch(() => undefined); // stays dirty — submit remains blocked
  }, [buildDocument]);

  // -- load (quizzer.ts:112-141 + quiz.ts:190-236) --------------------------------

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setErrorMessage('');
    setAsStudent(!(propsRef.current.isInstructor?.() ?? false));
    void propsRef.current
      .loadAssignment(props.assignmentId)
      .then((result) => {
        if (cancelled || !result) {
          if (!result) console.error('Failed to load', props.assignmentId);
          return;
        }
        const instructions = parseQuizInstructions(result.assignment.instructions);
        const baseDoc = parseQuizSubmission(result.submission?.code ?? '');
        const initialSeed = result.submission?.id ?? 0;
        const count = baseDoc.attempt?.count ?? 0;
        const initialAnswers: Record<QuestionId, StudentAnswer> = {};
        for (const [questionId, question] of Object.entries(instructions.questions ?? {})) {
          question.id = questionId; // reinjected at load (quiz.ts:206-207)
          // LD-7 restore: a previously-hidden answer returns when visible.
          const previous =
            baseDoc.studentAnswers?.[questionId] ?? baseDoc.hiddenAnswers?.[questionId];
          initialAnswers[questionId] = defaultAnswer(question, previous);
        }
        setLoaded({
          assignment: result.assignment,
          submission: result.submission,
          instructions,
          baseDoc,
        });
        setAnswers(initialAnswers);
        setFeedback((baseDoc.feedback ?? {}) as Record<QuestionId, QuizQuestionFeedback | null>);
        setAttempting(baseDoc.attempt?.attempting ?? false);
        setAttemptCount(count);
        setMulligans(baseDoc.attempt?.mulligans ?? 0);
        setSeed(initialSeed);
        setVisible(selectVisibleQuestions(instructions, initialSeed, count));
        // Reading preamble id: numeric direct, url slug via lookup.
        const rawReadingId = instructions.settings?.readingId ?? null;
        if (typeof rawReadingId === 'string') {
          propsRef.current
            .lookupReadingId?.(rawReadingId)
            .then((id) => !cancelled && setReadingId(id))
            .catch(() => {
              setReadingId(null);
              console.error(`Failed to look up reading ID for ${rawReadingId}`);
            });
        } else {
          setReadingId(rawReadingId);
        }
        // Countdown feed from the ASSIGNMENT settings (§9.4, A3 §3.6).
        let settingsTimeLimit: string | null = null;
        try {
          const assignmentSettings = JSON.parse(result.assignment.settings || '{}') as Record<
            string,
            unknown
          >;
          settingsTimeLimit = (assignmentSettings['time_limit'] ?? null) as string | null;
        } catch {
          // Unparseable assignment settings: no limit.
        }
        propsRef.current.onTimeLimitInfo?.({
          timeLimit: settingsTimeLimit,
          studentTimeLimit: result.submission?.timeLimit ?? null,
          dateStarted: result.submission?.dateStarted ?? null,
        });
      })
      .catch((error) => {
        if (!cancelled) console.error('Failed to load (HTTP LEVEL)', error);
      });
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [props.assignmentId, reloadNonce]);

  // Tab-visibility telemetry (assignment_interface.ts:134-138 — all types).
  useEffect(() => {
    const onVisibility = () =>
      propsRef.current.logEvent?.(
        'Resource.View',
        'reading',
        'visibility',
        document.visibilityState,
        loadedRef.current?.assignment.url ?? '',
      );
    window.addEventListener('visibilitychange', onVisibility);
    return () => window.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // -- answer changes (quizzer.ts:143-148; 400 ms rate limit for text) -----------

  const handleAnswerChange = useCallback(
    (questionId: QuestionId, type: string, value: StudentAnswer) => {
      setAnswers((previous) => ({ ...previous, [questionId]: value }));
      if (!stateRef.current.attempting) return;
      setIsDirty(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (TEXT_TYPES.has(type)) {
        saveTimerRef.current = setTimeout(saveSubmission, 400);
      } else {
        // Radios/checkboxes/selects autosave immediately (no rate limit) —
        // scheduled as a microtask so the state update lands first.
        saveTimerRef.current = setTimeout(saveSubmission, 0);
      }
    },
    [saveSubmission],
  );

  // -- attempt lifecycle ----------------------------------------------------------

  const startQuiz = useCallback(() => {
    const current = loadedRef.current;
    if (!current) return;
    setErrorMessage('');
    const nextCount = stateRef.current.attemptCount + 1;
    setAttemptCount(nextCount);
    setAttempting(true);
    setFeedback({});
    // hidePools with the (possibly instructor-edited) seed; answers are NOT
    // cleared (quizzer.ts:190 is commented out in legacy).
    setVisible(selectVisibleQuestions(current.instructions, seed, nextCount));
    // Save with the updated attempt block.
    setTimeout(saveSubmission, 0);
  }, [seed, saveSubmission]);

  const submit = useCallback(() => {
    const current = loadedRef.current;
    const { submitQuiz, markCorrect } = propsRef.current;
    if (!current || !submitQuiz) return;
    submitQuiz(current.assignment.id, current.submission?.id ?? null)
      .then((response) => {
        if (response.feedbacks) {
          setFeedback((previous) => ({ ...previous, ...response.feedbacks }));
        }
        if (!response.success) {
          console.error(response);
          setErrorMessage(response.message ?? 'Failed to submit the quiz.');
        }
        // The server already rewrote the stored document with
        // attempting: false (regrade_if_quiz); the client just mirrors it.
        setAttempting(false);
        if (response.correct && markCorrect) {
          markCorrect(current.assignment.id);
        }
      })
      .catch((error) => {
        console.error('Failed to load (HTTP LEVEL)', error);
        setErrorMessage(
          'HTTP ERROR (try reloading the page; if still an error, report to instructor!): ' +
            String(error),
        );
      });
  }, []);

  // -- derived ---------------------------------------------------------------------

  const mode: QuizMode = attempting ? 'ATTEMPTING' : attemptCount > 0 ? 'COMPLETED' : 'READY';
  const attemptLimit = loaded?.instructions.settings?.attemptLimit ?? -1;
  const feedbackType = loaded?.instructions.settings?.feedbackType ?? 'IMMEDIATE';
  const canAttempt = attemptLimit === -1 || attemptLimit + mulligans - attemptCount > 0;
  const attemptsLeft = attemptsLeftText(attemptLimit, mulligans, attemptCount);
  const readOnly = !attempting;

  const renderMarkdown = useMemo(() => {
    const assignmentId = loaded?.assignment.id;
    return (text: string) =>
      renderReadingMarkdown(text, {
        downloadUrl: (link) =>
          assignmentId != null
            ? (propsRef.current.downloadUrl?.(assignmentId, link) ?? link)
            : link,
      });
  }, [loaded?.assignment.id]);

  const pools = useMemo(() => (loaded ? poolByQuestion(loaded.instructions) : new Map()), [loaded]);

  const questionEntries = useMemo(
    () => Object.entries(loaded?.instructions.questions ?? {}),
    [loaded],
  );

  // The quiz OWNS its surface (§12): its events/persistence carry its own
  // ids; the preamble reading renders as a child surface with the
  // READING's ids (the legacy AssignmentInterfaces each built payloads
  // from their own loaded pair).
  const withSurface = (children: ReactNode, ids: { a: number | null; s: number | null }) => (
    <AssignmentSurface
      assignmentId={ids.a}
      submissionId={ids.s}
      variant="full"
      {...(props.logEvent ? { logEvent: props.logEvent } : {})}
    >
      {children}
    </AssignmentSurface>
  );

  if (!loaded) {
    return withSurface(<div className="blockpy-quizzer">{errorMessage || 'Loading quiz…'}</div>, {
      a: null,
      s: null,
    });
  }

  // The visual editor is the instructor's normal workflow (new requirement,
  // 2026-07-11); "Actual Quiz" shows the student-facing surface.
  const activeView = editorView ?? (isInstructor ? 'editor' : 'quiz');
  const viewToggle = isInstructor && (
    <div className="quizzer-view-toggle m-2">
      {(
        [
          ['editor', 'Quiz Editor'],
          ['quiz', 'Actual Quiz'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={`btn btn-sm mr-1 ${activeView === value ? 'btn-success' : 'btn-outline-secondary'}`}
          onClick={() => setEditorView(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
  // Subordinate-reading preamble (settings.readingId, quiz_ui.ts:194-208).
  // Students get the reading rendered in full above the quiz; instructor
  // views get a collapse toggle (expanded by default) instead of legacy's
  // static "Reading is hidden" note (LD-31).
  const collapsedReading = readingId !== null && props.renderReading && (
    <div className="quizzer-reading-preamble quizzer-reading-collapsed">
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        aria-expanded={showReading}
        onClick={() => setShowReading((value) => !value)}
      >
        {showReading ? 'Hide Subordinate Reading' : 'Show Subordinate Reading'}
      </button>
      {showReading && props.renderReading(readingId)}
    </div>
  );

  if (isInstructor && activeView === 'editor') {
    const quizId = loaded.assignment.id;
    const submissionId = loaded.submission?.id ?? null;
    const { saveQuizAssignment, saveAnswer, submitQuiz } = props;
    return withSurface(
      <div className="blockpy-quizzer" style={{ backgroundColor: '#fcf8e3' }}>
        {viewToggle}
        {collapsedReading}
        <QuizEditor
          instructions={loaded.assignment.instructions}
          checks={loaded.assignment.onRun ?? ''}
          onSave={async (instructionsText, checksText) => {
            if (!saveQuizAssignment) return { success: false };
            const result = await saveQuizAssignment(quizId, instructionsText, checksText);
            // Reload so the student surface and Try It (remote) see the
            // persisted documents.
            if (result.success) setReloadNonce((nonce) => nonce + 1);
            return result;
          }}
          {...(saveAnswer && submitQuiz
            ? {
                remoteTryOut: {
                  saveAnswer: (code: string) => saveAnswer(quizId, submissionId, code),
                  submitQuiz: () => submitQuiz(quizId, submissionId),
                },
              }
            : {})}
          {...(props.downloadUrl
            ? { downloadUrl: (filename: string) => props.downloadUrl!(quizId, filename) }
            : {})}
        />
      </div>,
      { a: quizId, s: submissionId },
    );
  }

  const shuffleBase = poolSeed(loaded.instructions.settings?.poolRandomness, seed, attemptCount);

  const attemptBar = (position: 'below' | 'above') => (
    <div className="quizzer-attempt-bar">
      {isDirty && (
        <small className="alert alert-info p-1 border rounded float-right">Saving changes</small>
      )}
      {mode === 'READY' && (
        <div>
          To begin the quiz, click &quot;Start Quiz&quot;.
          <br />
          You have <span>{attemptsLeft}</span>
          <br />
          {canAttempt && (
            <div className="text-center">
              <button type="button" className="btn btn-success" onClick={startQuiz}>
                Start Quiz
              </button>
            </div>
          )}
        </div>
      )}
      {mode === 'ATTEMPTING' && (
        <div>
          <span>Quiz In Progress!</span>
          <br />
          <div className="text-center">
            <button type="button" className="btn btn-success" disabled={isDirty} onClick={submit}>
              Submit answer
            </button>
          </div>
        </div>
      )}
      {mode === 'COMPLETED' && (
        <div>
          You have completed the quiz.
          <br />
          {feedbackType === 'IMMEDIATE' && (
            <>
              You can see the feedback for each question {position}.
              <br />
            </>
          )}
          {feedbackType === 'SUMMARY' && (
            <>
              However, you will <strong>not</strong> see any feedback until the instructor releases
              grades; the feedback you receive will be limited.
              <br />
            </>
          )}
          {feedbackType === 'NONE' && (
            <>
              However, you will <strong>not</strong> see any feedback.
              <br />
            </>
          )}
          You have <span>{attemptsLeft}</span>
          <br />
          {canAttempt && (
            <div className="text-center">
              To try again, click &quot;Start Quiz&quot;.
              <br />
              <button type="button" className="btn btn-success" onClick={startQuiz}>
                Try Quiz Again
              </button>
            </div>
          )}
          You can now continue to the next part of the assignment.
        </div>
      )}
    </div>
  );

  return withSurface(
    <div
      className="blockpy-quizzer"
      style={{ backgroundColor: '#fcf8e3', paddingBottom: '1px', paddingTop: '1px' }}
    >
      {viewToggle}
      {errorMessage.length > 0 && (
        <div className="alert alert-warning p-1 border rounded float-right">{errorMessage}</div>
      )}
      {isInstructor && (
        <div className="form-check">
          <input
            type="checkbox"
            className="form-check-input"
            id="quizzer-as-student"
            checked={asStudent}
            onChange={(event) => setAsStudent(event.target.checked)}
          />
          <label className="form-check-label" htmlFor="quizzer-as-student">
            View As Student
          </label>
        </div>
      )}
      {readingId !== null && asStudent && props.renderReading && (
        <div className="quizzer-reading-preamble">{props.renderReading(readingId)}</div>
      )}
      {readingId !== null &&
        !asStudent &&
        (collapsedReading || (
          <div>
            <strong>
              Reading is hidden; Click &quot;View as Student&quot; to preview the Reading.
            </strong>
            <hr />
          </div>
        ))}
      {attemptBar('below')}
      {isInstructor && (
        <div className="form-group">
          <label htmlFor="quizzer-seed-editor">
            Current Seed:{' '}
            <input
              type="text"
              id="quizzer-seed-editor"
              className="form-control"
              value={seed}
              onChange={(event) => setSeed(parseInt(event.target.value, 10) || 0)}
            />
          </label>
        </div>
      )}
      {(!asStudent || attemptCount > 0) && (
        <div className="quizzer-overview">
          <span>Overview: </span>
          {questionEntries
            .filter(([questionId]) => !asStudent || visible.has(questionId))
            .map(([questionId, question], index) => (
              <StatusSquare
                key={questionId}
                status={questionStatusCode(
                  question,
                  answers[questionId],
                  feedback[questionId],
                  asStudent,
                  feedbackType,
                )}
                indexId={index + 1}
              />
            ))}
        </div>
      )}
      <a id="quiz-start" />
      {questionEntries.map(([questionId, question], index) =>
        visible.has(questionId) || !asStudent ? (
          <QuestionView
            key={questionId}
            index={index + 1}
            question={question}
            answer={answers[questionId] ?? ''}
            feedback={feedback[questionId] ?? null}
            readOnly={readOnly}
            asStudent={asStudent}
            feedbackType={feedbackType}
            attemptCount={attemptCount}
            pool={pools.get(questionId)}
            shuffleSeed={shuffleBase + index * 1000}
            onChange={(value) => handleAnswerChange(questionId, question.type, value)}
            renderMarkdown={renderMarkdown}
          />
        ) : null,
      )}
      {attemptBar('above')}
      {errorMessage.length > 0 && (
        <div className="alert alert-warning p-1 border rounded">{errorMessage}</div>
      )}
    </div>,
    { a: loaded.assignment.id, s: loaded.submission?.id ?? null },
  );
}
