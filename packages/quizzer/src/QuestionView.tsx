/**
 * One quiz question card — the React port of questions_ui.html plus the
 * `makeBody` blank-injection (quiz.ts:315-346) and the status square
 * (quizzer_question_status.ts). Bodies/choices render through the reader
 * markdown pipeline (the legacy `markdowned` binding is the same
 * markdown-it instance for quizzes, A6 §2).
 *
 * Blank placeholders ([blank_id] in dropdown/fill-in bodies) become slot
 * spans in the rendered HTML; controlled inputs portal into them — the
 * same hydration pattern the reader uses for runnable fences.
 *
 * LD-1: matching/dropdown option shuffles are SEEDED (submission-id(+
 * attempt) + a per-question offset) instead of legacy's unseeded
 * `Math.random` per render, so option order is stable across reloads
 * within an attempt.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SQUARE_BRACKETS, isAnswered, seededShuffle } from './documents';
import type {
  KeyedTextAnswer,
  MatchingAnswer,
  QuestionPool,
  QuizFeedbackType,
  QuizQuestion,
  QuizQuestionFeedback,
  StudentAnswer,
} from './types';

/** questions.ts:4 — negative lookbehind/ahead keep \[escapes] and [links](…). */
const matchKeyInBrackets = (key: string) =>
  new RegExp(String.raw`(?<!\\)(\[${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\])(?!\()`);

/** quizzer_question_status.ts:55-78. */
export function questionStatusCode(
  question: QuizQuestion,
  answer: StudentAnswer | undefined,
  feedback: QuizQuestionFeedback | null | undefined,
  asStudent: boolean,
  feedbackType: QuizFeedbackType,
): 'unanswered' | 'answered' | 'error' | 'correct' | 'incorrect' {
  if (feedback && (!asStudent || feedbackType === 'IMMEDIATE')) {
    if (feedback.status === 'error') return 'error';
    return feedback.correct ? 'correct' : 'incorrect';
  }
  return isAnswered(question, answer) ? 'answered' : 'unanswered';
}

const STATUS_STYLE: Record<string, { color: string; filled: boolean }> = {
  unanswered: { color: '#6c757d', filled: false },
  answered: { color: '#6c757d', filled: true },
  error: { color: '#17a2b8', filled: true },
  correct: { color: '#28a745', filled: true },
  incorrect: { color: '#dc3545', filled: true },
};

/** The fa square glyphs → an inline SVG square (same visual states). */
export function StatusSquare({
  status,
  indexId,
  anchor,
}: {
  status: keyof typeof STATUS_STYLE;
  indexId: number;
  anchor?: boolean;
}) {
  const { color, filled } = STATUS_STYLE[status] ?? STATUS_STYLE['unanswered']!;
  return (
    <span
      title={`Question ${indexId}`}
      className={`quizzer-question-status quizzer-status-${status}`}
      {...(anchor ? { id: `quizzer-question-anchor-${indexId}` } : {})}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden style={{ margin: '0 1px' }}>
        <rect
          x="2"
          y="2"
          width="12"
          height="12"
          rx="1"
          fill={filled ? color : 'white'}
          stroke={color}
          strokeWidth="1.5"
        />
      </svg>
    </span>
  );
}

export interface QuestionViewProps {
  /** 1-based display index. */
  index: number;
  question: QuizQuestion;
  answer: StudentAnswer;
  feedback: QuizQuestionFeedback | null;
  readOnly: boolean;
  asStudent: boolean;
  feedbackType: QuizFeedbackType;
  attemptCount: number;
  pool?: QuestionPool | undefined;
  /** LD-1 seed for this question's option shuffles. */
  shuffleSeed: number;
  onChange: (answer: StudentAnswer) => void;
  renderMarkdown: (text: string) => string;
}

interface BlankSlot {
  element: HTMLElement;
  blank: string;
}

export function QuestionView(props: QuestionViewProps) {
  // Destructured (M5.1): exact hook deps without the whole `props`.
  const { renderMarkdown } = props;
  const { question, answer, feedback, readOnly, asStudent, feedbackType, index } = props;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [slots, setSlots] = useState<BlankSlot[]>([]);

  // makeBody (quiz.ts:315-346): swap [blank_id] for slot spans before the
  // markdown pass; unescape [[ ]] afterwards for dropdowns.
  const preparedBody = useMemo(() => {
    let body = question.body;
    if (question.type === 'multiple_dropdowns_question') {
      const answers = (question.answers ?? {}) as Record<string, string[]>;
      for (const key of Object.keys(answers)) {
        body = body.replace(
          matchKeyInBrackets(key),
          `<span class="quizzer-blank-slot" data-blank="${key}"></span>`,
        );
      }
      body = body.replace(/\[\[/g, '[').replace(/\]\]/g, ']');
    } else if (question.type === 'fill_in_multiple_blanks_question') {
      body = body
        .split(SQUARE_BRACKETS)
        .map((part) => {
          if (part.startsWith('[[') && part.endsWith(']]')) {
            return part.slice(1, -1);
          } else if (part.startsWith('[') && part.endsWith(']')) {
            const key = part.slice(1, -1);
            return `<span class="quizzer-blank-slot" data-blank="${key}"></span>`;
          }
          return part;
        })
        .join('');
    }
    return body;
  }, [question]);

  const bodyHtml = useMemo(() => renderMarkdown(preparedBody), [renderMarkdown, preparedBody]);

  // Students only see question content once an attempt exists
  // (questions_ui.html:25) — the slot scan must re-run when the body
  // first mounts, not just when its HTML changes.
  const contentVisible = !asStudent || props.attemptCount > 0;

  useEffect(() => {
    if (!bodyRef.current) {
      setSlots([]);
      return;
    }
    setSlots(
      Array.from(bodyRef.current.querySelectorAll<HTMLElement>('.quizzer-blank-slot')).map(
        (element) => ({ element, blank: element.dataset['blank'] ?? '' }),
      ),
    );
  }, [bodyHtml, contentVisible]);

  // Seeded option orders (LD-1) — stable per (question, seed) pair.
  const dropdownOptions = useMemo(() => {
    if (question.type !== 'multiple_dropdowns_question') return {};
    const answers = (question.answers ?? {}) as Record<string, string[]>;
    const result: Record<string, string[]> = {};
    Object.keys(answers).forEach((key, blankIndex) => {
      const options = question.retainOrder
        ? [...answers[key]!]
        : seededShuffle([...answers[key]!], props.shuffleSeed + blankIndex);
      result[key] = ['', ...options];
    });
    return result;
  }, [question, props.shuffleSeed]);

  const matchingOptions = useMemo(() => {
    if (question.type !== 'matching_question') return [];
    const options = (question.answers ?? []) as string[];
    return question.retainOrder ? [...options] : seededShuffle([...options], props.shuffleSeed);
  }, [question, props.shuffleSeed]);

  const setKeyed = (key: string, value: string) => {
    const current = { ...((answer ?? {}) as KeyedTextAnswer) };
    current[key] = value;
    props.onChange(current);
  };

  const showFeedback = Boolean(feedback) && (!asStudent || feedbackType === 'IMMEDIATE');
  const status = questionStatusCode(question, answer, feedback, asStudent, feedbackType);

  const controls = (() => {
    switch (question.type) {
      case 'true_false_question':
        return (
          <>
            {(['true', 'false'] as const).map((value) => (
              <div className="form-check" key={value}>
                <label className="form-check-label" htmlFor={`question-tf-${index}-${value[0]}`}>
                  <input
                    className="form-check-input"
                    type="radio"
                    value={value}
                    id={`question-tf-${index}-${value[0]}`}
                    name={`question-tf-${index}`}
                    checked={answer === value}
                    disabled={readOnly}
                    onChange={() => props.onChange(value)}
                  />
                  {value === 'true' ? 'True' : 'False'}
                </label>
              </div>
            ))}
          </>
        );
      case 'multiple_choice_question':
        // Radio options render as Markdown, never shuffled (A3 §1.2).
        return (
          <>
            {((question.answers ?? []) as string[]).map((option, optionIndex) => (
              <div className="form-check" key={optionIndex}>
                <label
                  className="form-check-label"
                  htmlFor={`question-mcq-${index}-${optionIndex}`}
                >
                  <input
                    className="form-check-input"
                    type="radio"
                    id={`question-mcq-${index}-${optionIndex}`}
                    name={`question-mcq-${index}-${optionIndex}`}
                    checked={answer === option}
                    disabled={readOnly}
                    onChange={() => props.onChange(option)}
                  />
                  <span dangerouslySetInnerHTML={{ __html: renderMarkdown(option) }} />
                </label>
              </div>
            ))}
          </>
        );
      case 'multiple_answers_question': {
        // Checkbox options render as RAW HTML (questions_ui.html:84).
        const checked = (answer ?? []) as string[];
        return (
          <>
            {((question.answers ?? []) as string[]).map((option, optionIndex) => (
              <div className="form-check" key={optionIndex}>
                <label
                  className="form-check-label"
                  htmlFor={`question-maq-${index}-${optionIndex}`}
                >
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`question-maq-${index}-${optionIndex}`}
                    name={`question-maq-${index}-${optionIndex}`}
                    checked={checked.includes(option)}
                    disabled={readOnly}
                    onChange={(event) =>
                      props.onChange(
                        event.target.checked
                          ? [...checked, option]
                          : checked.filter((existing) => existing !== option),
                      )
                    }
                  />
                  <span dangerouslySetInnerHTML={{ __html: option }} />
                </label>
              </div>
            ))}
          </>
        );
      }
      case 'text_only_question':
        return null;
      case 'matching_question': {
        const chosen = (answer ?? []) as MatchingAnswer;
        return (
          <div className="container">
            {(question.statements ?? []).map((statement, statementIndex) => (
              <div className="row justify-content-between mb-3" key={statementIndex}>
                <div
                  className="col"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(statement) }}
                />
                <div className="col">
                  <select
                    className="custom-select"
                    id={`question-mat-${index}-${statementIndex}`}
                    value={chosen[statementIndex] ?? ''}
                    disabled={readOnly}
                    onChange={(event) => {
                      const next = [...chosen];
                      next[statementIndex] = event.target.value || undefined;
                      props.onChange(next);
                    }}
                  >
                    <option value="" />
                    {matchingOptions.map((option, optionIndex) => (
                      <option key={optionIndex} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        );
      }
      case 'short_answer_question':
      case 'numerical_question':
        return (
          <div className="form-group">
            <input
              type={question.type === 'numerical_question' ? 'number' : 'text'}
              className="form-control"
              autoComplete="off"
              id={`question-sa-${index}`}
              value={(answer ?? '') as string}
              disabled={readOnly}
              onChange={(event) => props.onChange(event.target.value)}
            />
          </div>
        );
      case 'essay_question':
        return (
          <textarea
            style={{ width: '100%', height: '300px' }}
            autoComplete="off"
            id={`question-es-${index}`}
            value={(answer ?? '') as string}
            disabled={readOnly}
            onChange={(event) => props.onChange(event.target.value)}
          />
        );
      case 'multiple_dropdowns_question':
      case 'fill_in_multiple_blanks_question':
        return null; // inline blanks portal into the body
      default:
        // calculated/file_upload and anything unknown (questions_ui.html:141-143).
        return <>I have no idea what this is!</>;
    }
  })();

  return (
    <div className="card m-4 quizzer-question-card">
      <div className="quizzer-question card-body">
        <span className="float-right">
          <StatusSquare status={status} indexId={index} anchor />
        </span>
        <h5 className="card-title">Question {index}</h5>
        <h6 className="card-subtitle mb-2 text-muted">
          {showFeedback && feedback && (
            <span>
              {Math.round((feedback.score * question.points + Number.EPSILON) * 100) / 100}
              {' / '}
            </span>
          )}
          <span>{question.points}</span> points
          {!asStudent && <span> ({question.id})</span>}
        </h6>
        {props.pool && !asStudent && (
          <div className="quizzer-pool-badge">
            Pool: <span>{props.pool.name}</span>
          </div>
        )}
        {contentVisible && (
          <>
            <div
              ref={bodyRef}
              className="quizzer-question-body"
              // D4-A: unsanitized instructor content, legacy parity.
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
            {controls}
          </>
        )}
        {showFeedback && feedback && (
          <div
            className={`border rounded m-2 p-2 quizzer-feedback ${
              feedback.status === 'error'
                ? 'bg-dark'
                : feedback.correct
                  ? 'bg-success'
                  : 'bg-danger'
            }`}
          >
            <span className="text-white" dangerouslySetInnerHTML={{ __html: feedback.message }} />
          </div>
        )}
      </div>
      {slots.map((slot) =>
        createPortal(
          question.type === 'multiple_dropdowns_question' ? (
            <select
              className="quizzer-inline-select"
              id={`question-md-${index}-${slot.blank}`}
              value={((answer ?? {}) as KeyedTextAnswer)[slot.blank] ?? ''}
              disabled={readOnly}
              onChange={(event) => setKeyed(slot.blank, event.target.value)}
            >
              {(dropdownOptions[slot.blank] ?? ['']).map((option, optionIndex) => (
                <option key={optionIndex} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <span className="d-inline-block quizzer-blank-slot">
              <input
                type="text"
                className="form-control quizzer-inline-blank"
                autoComplete="off"
                id={`question-fimb-${index}-${slot.blank}`}
                value={((answer ?? {}) as KeyedTextAnswer)[slot.blank] ?? ''}
                disabled={readOnly}
                onChange={(event) => setKeyed(slot.blank, event.target.value)}
              />
            </span>
          ),
          slot.element,
          `${question.id}-${slot.blank}`,
        ),
      )}
    </div>
  );
}
