/**
 * Visual quiz editor (new requirement, 2026-07-11): the instructor-facing
 * authoring surface for a whole quiz — question editing per type, quiz
 * settings, pools, live validation (the bakery quiz_check port), and a
 * "Try It" mode that runs the REAL student Quizzer against the unsaved
 * draft, grading either locally (the process_quiz port) or remotely
 * (through the real save/submit endpoints).
 *
 * Fallback modes: Raw (the two document strings verbatim — the legacy RAW
 * editor) and JSON (pretty-printed with live parse errors — the legacy
 * FORM/jsoneditor analog). All three editors share ONE canonical state:
 * the raw instruction/check strings; unknown fields survive every mode.
 */
import { useCallback, useMemo, useState } from 'react';
import { renderReadingMarkdown } from '@blockpy/reader';
import { parseQuizInstructions } from '../documents';
import { processQuiz, type QuizChecksDocument } from '../grading';
import { validateQuiz, type QuizIssue } from '../validation';
import { QuestionEditor } from './QuestionEditor';
import { Quizzer } from '../Quizzer';
import type { QuizInstructions, QuizQuestion, QuizSubmitResponse } from '../types';

export type QuizEditorMode = 'VISUAL' | 'RAW' | 'JSON' | 'TRY';

export interface QuizEditorProps {
  /** Current saved documents (assignment.instructions / assignment.on_run). */
  instructions: string;
  checks: string;
  /** Persist both documents (saveFile !instructions.md + !on_run.py). */
  onSave: (instructions: string, checks: string) => Promise<{ success: boolean }>;
  /** Remote try-out: save the scratch answers + submit through the real
   *  endpoints (grades the SAVED documents server-side). */
  remoteTryOut?: {
    saveAnswer: (code: string) => Promise<{ success: boolean }>;
    submitQuiz: () => Promise<QuizSubmitResponse>;
  };
  downloadUrl?: (filename: string) => string;
}

const NEW_QUESTION: QuizQuestion = {
  type: 'multiple_choice_question',
  body: 'New question body',
  points: 1,
  answers: ['Option A', 'Option B'],
};

function parseChecks(raw: string): QuizChecksDocument {
  try {
    const parsed = JSON.parse(raw || '{}') as QuizChecksDocument;
    parsed.questions ??= {};
    return parsed;
  } catch {
    return { questions: {} };
  }
}

export function QuizEditor(props: QuizEditorProps) {
  // Destructured (M5.1): exact hook deps without the whole `props`.
  const { downloadUrl } = props;
  const [mode, setMode] = useState<QuizEditorMode>('VISUAL');
  // Canonical draft state: the two raw document strings.
  const [instructionsText, setInstructionsText] = useState(props.instructions);
  const [checksText, setChecksText] = useState(props.checks || '{"questions": {}}');
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [parseError, setParseError] = useState('');
  const [tryNonce, setTryNonce] = useState(0);

  const instructions = useMemo(() => parseQuizInstructions(instructionsText), [instructionsText]);
  const checks = useMemo(() => parseChecks(checksText), [checksText]);
  const issues = useMemo(() => validateQuiz(instructions, checks), [instructions, checks]);
  const issuesByQuestion = useMemo(() => {
    const map = new Map<string, QuizIssue[]>();
    for (const issue of issues) {
      const list = map.get(issue.questionId) ?? [];
      list.push(issue);
      map.set(issue.questionId, list);
    }
    return map;
  }, [issues]);
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;

  const renderMarkdown = useCallback(
    (text: string) =>
      renderReadingMarkdown(text, {
        downloadUrl: (link) => downloadUrl?.(link) ?? link,
      }),
    [downloadUrl],
  );

  const updateDocuments = useCallback(
    (nextInstructions: QuizInstructions, nextChecks: QuizChecksDocument) => {
      setInstructionsText(JSON.stringify(nextInstructions, null, 2));
      setChecksText(JSON.stringify(nextChecks, null, 2));
      setDirty(true);
      setSaveState('idle');
    },
    [],
  );

  const questionEntries = Object.entries(instructions.questions ?? {});

  const mutateQuestion = (
    questionId: string,
    question: QuizQuestion | null,
    check?: Record<string, unknown> | null,
    renameTo?: string,
  ) => {
    const nextQuestions = { ...(instructions.questions ?? {}) };
    const nextChecks = { ...(checks.questions ?? {}) };
    if (renameTo !== undefined) {
      // Preserve entry order while renaming (pools follow along).
      const renamedQuestions: typeof nextQuestions = {};
      for (const [key, value] of Object.entries(nextQuestions)) {
        renamedQuestions[key === questionId ? renameTo : key] = value;
      }
      const oldCheck = nextChecks[questionId];
      delete nextChecks[questionId];
      if (oldCheck !== undefined) nextChecks[renameTo] = oldCheck;
      const pools = (instructions.pools ?? []).map((pool) => ({
        ...pool,
        questions: pool.questions.map((id) => (id === questionId ? renameTo : id)),
      }));
      updateDocuments(
        { ...instructions, questions: renamedQuestions, pools },
        { ...checks, questions: nextChecks },
      );
      return;
    }
    if (question === null) {
      delete nextQuestions[questionId];
      delete nextChecks[questionId];
      const pools = (instructions.pools ?? []).map((pool) => ({
        ...pool,
        questions: pool.questions.filter((id) => id !== questionId),
      }));
      updateDocuments(
        { ...instructions, questions: nextQuestions, pools },
        { ...checks, questions: nextChecks },
      );
      return;
    }
    nextQuestions[questionId] = question;
    if (check !== undefined && check !== null) nextChecks[questionId] = check;
    updateDocuments(
      { ...instructions, questions: nextQuestions },
      { ...checks, questions: nextChecks },
    );
  };

  const moveQuestion = (questionId: string, delta: number) => {
    const keys = questionEntries.map(([key]) => key);
    const from = keys.indexOf(questionId);
    const to = from + delta;
    if (to < 0 || to >= keys.length) return;
    keys.splice(from, 1);
    keys.splice(to, 0, questionId);
    const reordered: Record<string, QuizQuestion> = {};
    for (const key of keys) reordered[key] = (instructions.questions ?? {})[key]!;
    updateDocuments({ ...instructions, questions: reordered }, checks);
  };

  const addQuestion = () => {
    let counter = questionEntries.length + 1;
    let newId = `question_${counter}`;
    while ((instructions.questions ?? {})[newId]) newId = `question_${(counter += 1)}`;
    mutateQuestion(newId, { ...NEW_QUESTION }, { correct: 'Option A' });
  };

  const save = () => {
    setSaveState('saving');
    void props
      .onSave(instructionsText, checksText)
      .then((result) => {
        setSaveState(result.success ? 'saved' : 'failed');
        if (result.success) setDirty(false);
      })
      .catch(() => setSaveState('failed'));
  };

  const settings = instructions.settings ?? {};
  const setSetting = (key: string, value: unknown) =>
    updateDocuments({ ...instructions, settings: { ...settings, [key]: value } }, checks);

  return (
    <div className="quizzer-quiz-editor">
      <div className="quizzer-editor-toolbar m-2">
        {(
          [
            ['VISUAL', 'Visual Editor'],
            ['RAW', 'Raw Editor'],
            ['JSON', 'JSON Editor'],
            ['TRY', 'Try It'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`btn btn-sm mr-1 ${mode === value ? 'btn-success' : 'btn-outline-secondary'}`}
            onClick={() => {
              setMode(value);
              if (value === 'TRY') setTryNonce((nonce) => nonce + 1);
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-sm btn-primary mr-1 quizzer-editor-save"
          disabled={!dirty || saveState === 'saving'}
          onClick={save}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save Quiz'}
        </button>
        {saveState === 'saved' && <small className="text-muted">Saved.</small>}
        {saveState === 'failed' && <small className="text-danger">Save failed — try again.</small>}
        <span className="float-right quizzer-editor-issue-count">
          {issues.length === 0
            ? 'No issues found'
            : `${issues.length} issue${issues.length === 1 ? '' : 's'} (${errorCount} error${errorCount === 1 ? '' : 's'})`}
        </span>
      </div>
      {parseError && <div className="alert alert-warning">{parseError}</div>}

      {mode === 'VISUAL' && (
        <div className="quizzer-editor-visual">
          <div className="card m-2">
            <div className="card-body">
              <h5 className="card-title">Quiz Settings</h5>
              <label className="mr-2">
                Attempt limit (-1 = infinite){' '}
                <input
                  type="number"
                  className="form-control"
                  style={{ width: '6em', display: 'inline-block' }}
                  value={settings.attemptLimit ?? -1}
                  onChange={(event) => setSetting('attemptLimit', parseInt(event.target.value, 10))}
                />
              </label>
              <label className="mr-2">
                Feedback{' '}
                <select
                  className="custom-select"
                  value={settings.feedbackType ?? 'IMMEDIATE'}
                  onChange={(event) => setSetting('feedbackType', event.target.value)}
                >
                  <option value="IMMEDIATE">IMMEDIATE</option>
                  <option value="NONE">NONE</option>
                  <option value="SUMMARY">SUMMARY</option>
                </select>
              </label>
              <label className="mr-2">
                Pool randomness{' '}
                <select
                  className="custom-select"
                  value={settings.poolRandomness ?? 'ATTEMPT'}
                  onChange={(event) => setSetting('poolRandomness', event.target.value)}
                >
                  <option value="SEED">SEED</option>
                  <option value="ATTEMPT">ATTEMPT</option>
                  <option value="NONE">NONE</option>
                </select>
              </label>
              <label>
                Reading preamble id{' '}
                <input
                  className="form-control"
                  style={{ width: '10em', display: 'inline-block' }}
                  value={settings.readingId == null ? '' : String(settings.readingId)}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setSetting(
                      'readingId',
                      raw === '' ? null : /^\d+$/.test(raw) ? parseInt(raw, 10) : raw,
                    );
                  }}
                />
              </label>
              {(instructions.pools ?? []).length > 0 && (
                <div className="quizzer-editor-pools">
                  <h6>Pools</h6>
                  {(instructions.pools ?? []).map((pool, poolIndex) => (
                    <div key={poolIndex}>
                      <input
                        value={pool.name}
                        onChange={(event) => {
                          const pools = [...(instructions.pools ?? [])];
                          pools[poolIndex] = { ...pool, name: event.target.value };
                          updateDocuments({ ...instructions, pools }, checks);
                        }}
                      />{' '}
                      shows{' '}
                      <input
                        type="number"
                        style={{ width: '4em' }}
                        value={pool.amount}
                        onChange={(event) => {
                          const pools = [...(instructions.pools ?? [])];
                          pools[poolIndex] = {
                            ...pool,
                            amount: parseInt(event.target.value, 10) || 0,
                          };
                          updateDocuments({ ...instructions, pools }, checks);
                        }}
                      />{' '}
                      of: {pool.questions.join(', ') || '(empty)'}{' '}
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => {
                          const pools = (instructions.pools ?? []).filter(
                            (_, index) => index !== poolIndex,
                          );
                          updateDocuments({ ...instructions, pools }, checks);
                        }}
                      >
                        Remove pool
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary mt-1"
                onClick={() =>
                  updateDocuments(
                    {
                      ...instructions,
                      pools: [
                        ...(instructions.pools ?? []),
                        {
                          name: `pool_${(instructions.pools ?? []).length + 1}`,
                          amount: 1,
                          questions: [],
                        },
                      ],
                    },
                    checks,
                  )
                }
              >
                Add pool
              </button>
            </div>
          </div>
          {questionEntries.map(([questionId, question], index) => (
            <QuestionEditor
              key={questionId}
              questionId={questionId}
              question={question}
              check={(checks.questions ?? {})[questionId] ?? {}}
              issues={issuesByQuestion.get(questionId) ?? []}
              index={index}
              count={questionEntries.length}
              renderMarkdown={renderMarkdown}
              onChangeQuestion={(next) => mutateQuestion(questionId, next)}
              onChangeCheck={(next) => mutateQuestion(questionId, question, next)}
              onRename={(newId) => mutateQuestion(questionId, question, undefined, newId)}
              onDelete={() => mutateQuestion(questionId, null)}
              onMove={(delta) => moveQuestion(questionId, delta)}
            />
          ))}
          <div className="text-center mb-4">
            <button
              type="button"
              className="btn btn-success quizzer-editor-add"
              onClick={addQuestion}
            >
              Add Question
            </button>
          </div>
        </div>
      )}

      {(mode === 'RAW' || mode === 'JSON') && (
        <div className="quizzer-editor-raw m-2">
          <h6>Instructions (questions, settings, pools)</h6>
          <textarea
            className="form-control quizzer-editor-instructions-text"
            style={{ width: '100%', height: '300px', fontFamily: 'monospace' }}
            value={instructionsText}
            onChange={(event) => {
              setInstructionsText(event.target.value);
              setDirty(true);
              setSaveState('idle');
              if (mode === 'JSON') {
                try {
                  JSON.parse(event.target.value);
                  setParseError('');
                } catch (error) {
                  setParseError(`Instructions JSON: ${String(error)}`);
                }
              }
            }}
            onBlur={() => {
              if (mode === 'JSON') {
                try {
                  setInstructionsText(JSON.stringify(JSON.parse(instructionsText), null, 2));
                } catch {
                  // Leave unformatted; the error banner is already up.
                }
              }
            }}
          />
          <h6>Checks / On Run (correct answers + feedback)</h6>
          <textarea
            className="form-control quizzer-editor-checks-text"
            style={{ width: '100%', height: '300px', fontFamily: 'monospace' }}
            value={checksText}
            onChange={(event) => {
              setChecksText(event.target.value);
              setDirty(true);
              setSaveState('idle');
              if (mode === 'JSON') {
                try {
                  JSON.parse(event.target.value);
                  setParseError('');
                } catch (error) {
                  setParseError(`Checks JSON: ${String(error)}`);
                }
              }
            }}
            onBlur={() => {
              if (mode === 'JSON') {
                try {
                  setChecksText(JSON.stringify(JSON.parse(checksText), null, 2));
                } catch {
                  // Leave unformatted.
                }
              }
            }}
          />
        </div>
      )}

      {mode === 'TRY' && (
        <TryItPanel
          key={tryNonce}
          instructionsText={instructionsText}
          instructions={instructions}
          checks={checks}
          dirty={dirty}
          remoteTryOut={props.remoteTryOut}
          downloadUrl={downloadUrl}
        />
      )}
    </div>
  );
}

/**
 * Try It: the real student Quizzer running against the DRAFT documents.
 * Local grading runs the process_quiz port on the draft checks instantly;
 * remote grading saves the scratch answers and submits through the real
 * endpoints (grading the last SAVED documents server-side).
 */
function TryItPanel(props: {
  instructionsText: string;
  instructions: QuizInstructions;
  checks: QuizChecksDocument;
  dirty: boolean;
  remoteTryOut?: QuizEditorProps['remoteTryOut'];
  downloadUrl?: (filename: string) => string;
}) {
  const [gradeMode, setGradeMode] = useState<'local' | 'remote'>('local');
  const [summary, setSummary] = useState('');
  const scratchAnswers = { current: '' };

  const loadDraft = useCallback(
    async () => ({
      assignment: {
        id: -1,
        name: 'Draft quiz',
        url: 'draft',
        instructions: props.instructionsText,
        settings: '{}',
      },
      submission: {
        id: 1,
        code: '',
        correct: false,
        dateStarted: null,
        timeLimit: null,
      },
    }),
    [props.instructionsText],
  );

  return (
    <div className="quizzer-editor-tryit m-2">
      <div className="mb-1">
        <label className="mr-2">
          <input
            type="radio"
            name="quizzer-tryit-mode"
            checked={gradeMode === 'local'}
            onChange={() => setGradeMode('local')}
          />{' '}
          Grade locally (instant, uses the DRAFT — even unsaved changes)
        </label>
        <label>
          <input
            type="radio"
            name="quizzer-tryit-mode"
            checked={gradeMode === 'remote'}
            onChange={() => setGradeMode('remote')}
            disabled={!props.remoteTryOut}
          />{' '}
          Grade remotely (the real server grader; uses the last SAVED quiz
          {props.dirty ? ' — you have unsaved changes!' : ''})
        </label>
      </div>
      {summary && <div className="alert alert-info p-1 quizzer-tryit-summary">{summary}</div>}
      <Quizzer
        assignmentId={-1}
        loadAssignment={loadDraft}
        saveAnswer={async (_aid, _sid, code) => {
          scratchAnswers.current = code;
          if (gradeMode === 'remote' && props.remoteTryOut) {
            return props.remoteTryOut.saveAnswer(code);
          }
          return { success: true };
        }}
        submitQuiz={async () => {
          if (gradeMode === 'remote' && props.remoteTryOut) {
            const response = await props.remoteTryOut.submitQuiz();
            setSummary(
              `Remote grade: correct=${String(response.correct)} (server-graded the saved quiz)`,
            );
            return response;
          }
          const submission = JSON.parse(scratchAnswers.current || '{}');
          const result = processQuiz(props.instructions, props.checks, submission);
          setSummary(
            `Local grade: score ${(result.score * 100).toFixed(1)}% of ${result.pointsPossible} points; correct=${String(result.correct)}`,
          );
          return {
            success: true,
            correct: result.correct,
            feedbacks: result.feedbacks,
          };
        }}
        downloadUrl={(_, filename) => props.downloadUrl?.(filename) ?? filename}
        isInstructor={() => false /* take it exactly as a student would */}
      />
    </div>
  );
}
