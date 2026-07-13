/**
 * Per-question visual editor (spec: quiz-editor requirement, 2026-07-11).
 * Structured widgets cover the common authoring flows for every question
 * type; an Advanced (JSON) section exposes the full merged field set for
 * the rich shapes (alternative answers, per-answer feedback maps, regex
 * lists) so nothing in the latest engine is unreachable. Live issues come
 * from the validation port; the preview renders the real student
 * QuestionView and grades scratch answers through the LOCAL engine.
 */
import { useMemo, useState } from 'react';
import { QuestionView } from '../QuestionView';
import { defaultAnswer } from '../documents';
import { checkQuizQuestion } from '../grading';
import type { QuizIssue } from '../validation';
import type { QuizQuestion, QuizQuestionFeedback, StudentAnswer } from '../types';

export interface QuestionEditorProps {
  questionId: string;
  question: QuizQuestion;
  check: Record<string, unknown>;
  issues: QuizIssue[];
  index: number;
  count: number;
  renderMarkdown: (text: string) => string;
  onChangeQuestion: (question: QuizQuestion) => void;
  onChangeCheck: (check: Record<string, unknown>) => void;
  onRename: (newId: string) => void;
  onDelete: () => void;
  onMove: (delta: number) => void;
}

const QUESTION_TEMPLATE_TYPES = [
  'true_false_question',
  'multiple_choice_question',
  'multiple_answers_question',
  'matching_question',
  'multiple_dropdowns_question',
  'short_answer_question',
  'numerical_question',
  'fill_in_multiple_blanks_question',
  'essay_question',
  'text_only_question',
] as const;

const lines = (value: unknown): string =>
  Array.isArray(value) ? (value as string[]).join('\n') : '';
const unlines = (value: string): string[] => value.split('\n').filter((line) => line.length > 0);

function JsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (parsed: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState('');
  return (
    <label className="quizzer-editor-json-field" style={{ display: 'block' }}>
      {label}
      <textarea
        className="form-control"
        style={{ width: '100%', minHeight: '80px', fontFamily: 'monospace' }}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          try {
            onChange(JSON.parse(event.target.value));
            setError('');
          } catch (parseError) {
            setError(String(parseError));
          }
        }}
      />
      {error && <small className="text-danger">{error}</small>}
    </label>
  );
}

export function QuestionEditor(props: QuestionEditorProps) {
  const { question, check, questionId, issues } = props;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAnswer, setPreviewAnswer] = useState<StudentAnswer | null>(null);
  const [previewFeedback, setPreviewFeedback] = useState<QuizQuestionFeedback | null>(null);
  const [idDraft, setIdDraft] = useState(questionId);

  const setQ = (patch: Partial<QuizQuestion>) => props.onChangeQuestion({ ...question, ...patch });
  const setC = (field: string, value: unknown) => {
    const next = { ...check };
    if (value === undefined || value === '') delete next[field];
    else next[field] = value;
    props.onChangeCheck(next);
  };

  const answer = useMemo(
    () => previewAnswer ?? defaultAnswer(question, undefined),
    [previewAnswer, question],
  );

  const gradeLocally = () => {
    const result = checkQuizQuestion(question, check, answer);
    setPreviewFeedback(
      result === null
        ? { message: 'Unknown Type: ' + question.type, correct: null, score: 0, status: 'error' }
        : {
            message: String(result.message),
            correct: result.correct,
            score: result.score,
            status: 'graded',
          },
    );
  };

  const typeControls = (() => {
    switch (question.type) {
      case 'true_false_question':
        return (
          <>
            <div className="form-check">
              {(['true', 'false'] as const).map((value) => (
                <label key={value} className="mr-2">
                  <input
                    type="radio"
                    name={`edit-tf-${questionId}`}
                    checked={check['correct'] === (value === 'true')}
                    onChange={() => setC('correct', value === 'true')}
                  />{' '}
                  Correct answer: {value}
                </label>
              ))}
            </div>
            <label style={{ display: 'block' }}>
              Feedback when wrong
              <input
                className="form-control"
                value={(check['wrong'] as string) ?? ''}
                onChange={(event) => setC('wrong', event.target.value)}
              />
            </label>
          </>
        );
      case 'multiple_choice_question':
      case 'multiple_answers_question': {
        const options = (question.answers ?? []) as string[];
        const multi = question.type === 'multiple_answers_question';
        const correct = multi ? ((check['correct'] ?? []) as string[]) : check['correct'];
        return (
          <>
            <label style={{ display: 'block' }}>
              Options (one per line)
              <textarea
                className="form-control"
                style={{ width: '100%' }}
                value={lines(question.answers)}
                onChange={(event) => setQ({ answers: unlines(event.target.value) })}
              />
            </label>
            <fieldset>
              <legend style={{ fontSize: '1em' }}>Correct answer{multi ? 's' : ''}</legend>
              {options.map((option, optionIndex) => (
                <div className="form-check" key={optionIndex}>
                  <label>
                    <input
                      type={multi ? 'checkbox' : 'radio'}
                      name={`edit-correct-${questionId}`}
                      checked={
                        multi
                          ? (correct as string[]).includes(option)
                          : Array.isArray(correct)
                            ? (correct as string[]).includes(option)
                            : correct === option
                      }
                      onChange={(event) => {
                        if (multi) {
                          const set = new Set(correct as string[]);
                          if (event.target.checked) set.add(option);
                          else set.delete(option);
                          setC('correct', [...set]);
                        } else {
                          setC('correct', option);
                        }
                      }}
                    />{' '}
                    {option}
                  </label>
                </div>
              ))}
            </fieldset>
            {multi ? (
              <label style={{ display: 'block' }}>
                Feedback when any wrong (wrong_any)
                <input
                  className="form-control"
                  value={(check['wrong_any'] as string) ?? ''}
                  onChange={(event) => setC('wrong_any', event.target.value)}
                />
              </label>
            ) : (
              <JsonField
                label="Per-answer feedback (answer → message)"
                value={check['feedback'] ?? {}}
                onChange={(parsed) => setC('feedback', parsed)}
              />
            )}
          </>
        );
      }
      case 'matching_question': {
        const statements = question.statements ?? [];
        const options = (question.answers ?? []) as string[];
        const correct = (check['correct'] ?? []) as Array<string | string[]>;
        return (
          <>
            <label style={{ display: 'block' }}>
              Statements (one per line)
              <textarea
                className="form-control"
                style={{ width: '100%' }}
                value={lines(question.statements)}
                onChange={(event) => setQ({ statements: unlines(event.target.value) })}
              />
            </label>
            <label style={{ display: 'block' }}>
              Options (one per line)
              <textarea
                className="form-control"
                style={{ width: '100%' }}
                value={lines(question.answers)}
                onChange={(event) => setQ({ answers: unlines(event.target.value) })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={question.retainOrder === true}
                onChange={(event) => setQ({ retainOrder: event.target.checked || undefined })}
              />{' '}
              Retain option order (no shuffle)
            </label>
            <fieldset>
              <legend style={{ fontSize: '1em' }}>Correct match per statement</legend>
              {statements.map((statement, statementIndex) => (
                <label key={statementIndex} style={{ display: 'block' }}>
                  {statement}{' '}
                  <select
                    className="custom-select"
                    value={
                      typeof correct[statementIndex] === 'string'
                        ? (correct[statementIndex] as string)
                        : ''
                    }
                    onChange={(event) => {
                      const next = [...correct];
                      next[statementIndex] = event.target.value;
                      setC('correct', next);
                    }}
                  >
                    <option value="" />
                    {options.map((option, optionIndex) => (
                      <option key={optionIndex} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {Array.isArray(correct[statementIndex]) && (
                    <small className="text-muted">
                      {' '}
                      (accepts any of: {(correct[statementIndex] as string[]).join(', ')} — edit in
                      Advanced)
                    </small>
                  )}
                </label>
              ))}
            </fieldset>
            <JsonField
              label="Per-statement feedback (statement → message)"
              value={check['feedback'] ?? {}}
              onChange={(parsed) => setC('feedback', parsed)}
            />
          </>
        );
      }
      case 'multiple_dropdowns_question': {
        const answers = (question.answers ?? {}) as Record<string, string[]>;
        const correct = (check['correct'] ?? {}) as Record<string, string>;
        return (
          <>
            <p className="text-muted">
              Blanks come from <code>[blank_id]</code> markers in the body.
            </p>
            {Object.keys(answers).map((blankId) => (
              <div key={blankId}>
                <label style={{ display: 'block' }}>
                  Options for [{blankId}] (one per line)
                  <textarea
                    className="form-control"
                    style={{ width: '100%' }}
                    value={lines(answers[blankId])}
                    onChange={(event) =>
                      setQ({ answers: { ...answers, [blankId]: unlines(event.target.value) } })
                    }
                  />
                </label>
                <label style={{ display: 'block' }}>
                  Correct for [{blankId}]{' '}
                  <select
                    className="custom-select"
                    value={correct[blankId] ?? ''}
                    onChange={(event) =>
                      setC('correct', { ...correct, [blankId]: event.target.value })
                    }
                  >
                    <option value="" />
                    {(answers[blankId] ?? []).map((option, optionIndex) => (
                      <option key={optionIndex} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
            <JsonField
              label="Blank options (blank_id → options) — add/remove blanks here"
              value={question.answers ?? {}}
              onChange={(parsed) => setQ({ answers: parsed as Record<string, string[]> })}
            />
            <label style={{ display: 'block' }}>
              Feedback when any wrong (wrong_any)
              <input
                className="form-control"
                value={(check['wrong_any'] as string) ?? ''}
                onChange={(event) => setC('wrong_any', event.target.value)}
              />
            </label>
          </>
        );
      }
      case 'short_answer_question':
      case 'numerical_question': {
        const usesRegex = 'correct_regex' in check;
        return (
          <>
            <label className="mr-2">
              <input
                type="radio"
                name={`edit-samode-${questionId}`}
                checked={!usesRegex}
                onChange={() => {
                  const next = { ...check };
                  delete next['correct_regex'];
                  next['correct'] = next['correct'] ?? '';
                  props.onChangeCheck(next);
                }}
              />{' '}
              Exact match
            </label>
            <label>
              <input
                type="radio"
                name={`edit-samode-${questionId}`}
                checked={usesRegex}
                onChange={() => {
                  const next = { ...check };
                  delete next['correct'];
                  delete next['correct_exact'];
                  next['correct_regex'] = next['correct_regex'] ?? [];
                  props.onChangeCheck(next);
                }}
              />{' '}
              Regular expressions
            </label>
            {usesRegex ? (
              <label style={{ display: 'block' }}>
                Accepted patterns (one regex per line)
                <textarea
                  className="form-control"
                  style={{ width: '100%', fontFamily: 'monospace' }}
                  value={lines(check['correct_regex'])}
                  onChange={(event) => setC('correct_regex', unlines(event.target.value))}
                />
              </label>
            ) : (
              <label style={{ display: 'block' }}>
                Accepted answers (one per line; single line = exact string)
                <textarea
                  className="form-control"
                  style={{ width: '100%' }}
                  value={
                    typeof (check['correct'] ?? check['correct_exact']) === 'string'
                      ? ((check['correct'] ?? check['correct_exact']) as string)
                      : lines(check['correct'] ?? check['correct_exact'])
                  }
                  onChange={(event) => {
                    const parts = unlines(event.target.value);
                    setC('correct', parts.length === 1 ? parts[0] : parts);
                  }}
                />
              </label>
            )}
            <label style={{ display: 'block' }}>
              Feedback when wrong (wrong_any)
              <input
                className="form-control"
                value={(check['wrong_any'] as string) ?? ''}
                onChange={(event) => setC('wrong_any', event.target.value)}
              />
            </label>
            <JsonField
              label="Per-answer feedback (answer/regex → message)"
              value={check['feedback'] ?? {}}
              onChange={(parsed) => setC('feedback', parsed)}
            />
          </>
        );
      }
      case 'fill_in_multiple_blanks_question':
        return (
          <>
            <p className="text-muted">
              Blanks come from <code>[blank_id]</code> markers in the body.
            </p>
            <JsonField
              label="Correct answers (blank_id → string | [strings]); use correct_regex for patterns"
              value={check['correct'] ?? check['correct_exact'] ?? {}}
              onChange={(parsed) => setC('correct', parsed)}
            />
            <label style={{ display: 'block' }}>
              Feedback when any wrong (wrong_any)
              <input
                className="form-control"
                value={(check['wrong_any'] as string) ?? ''}
                onChange={(event) => setC('wrong_any', event.target.value)}
              />
            </label>
          </>
        );
      default:
        return (
          <p className="text-muted">
            No structured editor for {question.type}; use Advanced (JSON) below.
          </p>
        );
    }
  })();

  return (
    <div className="card m-2 quizzer-editor-question" data-question-id={questionId}>
      <div className="card-body">
        <span className="float-right">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary mr-1"
            disabled={props.index === 0}
            onClick={() => props.onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary mr-1"
            disabled={props.index === props.count - 1}
            onClick={() => props.onMove(1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={props.onDelete}
          >
            Delete
          </button>
        </span>
        <h5 className="card-title">
          Question {props.index + 1}{' '}
          <input
            className="quizzer-editor-id"
            style={{ width: '10em' }}
            value={idDraft}
            onChange={(event) => setIdDraft(event.target.value)}
            onBlur={() => idDraft !== questionId && idDraft && props.onRename(idDraft)}
          />
        </h5>
        {issues.length > 0 && (
          <ul className="quizzer-editor-issues">
            {issues.map((issue, issueIndex) => (
              <li
                key={issueIndex}
                className={issue.severity === 'error' ? 'text-danger' : 'text-warning'}
              >
                <strong>{issue.field}</strong>: {issue.message}
              </li>
            ))}
          </ul>
        )}
        <div className="form-group">
          <label className="mr-2">
            Type{' '}
            <select
              className="custom-select"
              value={question.type}
              onChange={(event) => setQ({ type: event.target.value as QuizQuestion['type'] })}
            >
              {QUESTION_TEMPLATE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Points{' '}
            <input
              type="number"
              className="form-control"
              style={{ width: '6em', display: 'inline-block' }}
              value={question.points ?? 1}
              onChange={(event) => setQ({ points: parseFloat(event.target.value) || 0 })}
            />
          </label>
        </div>
        <label style={{ display: 'block' }}>
          Body (Markdown/HTML
          {question.type.includes('blank') || question.type.includes('dropdown')
            ? '; [blank_id] markers become inputs'
            : ''}
          )
          <textarea
            className="form-control quizzer-editor-body"
            style={{ width: '100%', minHeight: '80px' }}
            value={question.body}
            onChange={(event) => setQ({ body: event.target.value })}
          />
        </label>
        <label style={{ display: 'block' }}>
          Tags (comma-separated learning objectives)
          <input
            className="form-control"
            value={((question.tags ?? []) as string[]).join(', ')}
            onChange={(event) =>
              setQ({
                tags: event.target.value
                  ? event.target.value.split(',').map((tag) => tag.trim())
                  : undefined,
              })
            }
          />
        </label>
        {typeControls}
        <details className="quizzer-editor-advanced">
          <summary>Advanced (JSON)</summary>
          <JsonField
            label="Question (instructions document entry)"
            value={question}
            onChange={(parsed) => props.onChangeQuestion(parsed as QuizQuestion)}
          />
          <JsonField
            label="Check (on_run document entry — correct/feedback fields)"
            value={check}
            onChange={(parsed) => props.onChangeCheck(parsed as Record<string, unknown>)}
          />
        </details>
        <details
          className="quizzer-editor-preview"
          open={previewOpen}
          onToggle={(event) => setPreviewOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary>Preview &amp; grade (local)</summary>
          {previewOpen && (
            <>
              <QuestionView
                index={props.index + 1}
                question={question}
                answer={answer}
                feedback={previewFeedback}
                readOnly={false}
                asStudent={false}
                feedbackType="IMMEDIATE"
                attemptCount={1}
                shuffleSeed={1}
                onChange={(value) => {
                  setPreviewAnswer(value);
                  setPreviewFeedback(null);
                }}
                renderMarkdown={props.renderMarkdown}
              />
              <button type="button" className="btn btn-sm btn-success" onClick={gradeLocally}>
                Grade this answer
              </button>
            </>
          )}
        </details>
      </div>
    </div>
  );
}
