/**
 * Derive correct and deliberately-wrong student answers for a bakery quiz
 * from its checks document (the assignment's `on_run` JSON) — the same
 * check shapes `@blockpy/quizzer` grading consumes (grading.ts, a port of
 * blockpy-server quizzes.py). The curriculum walker grades BOTH derived
 * submissions through `processQuiz`: the wrong one must not be correct,
 * the correct one must score 100%. Anything underivable (regex-only
 * checks, unsupported types, unauthored checks) is reported instead of
 * silently skipped.
 */
import type {
  QuizInstructions,
  QuizQuestion,
  StudentAnswer,
  QuestionId,
} from '../../packages/quizzer/src/types';
import type { QuizChecksDocument } from '../../packages/quizzer/src/grading';

export interface DerivedQuestion {
  /** Submission value that should grade 100% for this question. */
  correct?: StudentAnswer;
  /** Submission value that should grade incorrect. Absent for questions
   *  that cannot be wrong (essay/text-only) or where no wrong option
   *  exists (single-option multiple choice). */
  wrong?: StudentAnswer;
  /** essay/text_only: every submission grades correct. */
  alwaysCorrect?: boolean;
  /** Why `correct` could not be derived (regex-only, unsupported, …). */
  underivable?: string;
  /** Authoring smells worth surfacing (correct value not among options). */
  notes: string[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** First concrete string out of a `correct` field (string | string[]). */
function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const found = value.find((entry) => typeof entry === 'string');
    return typeof found === 'string' ? found : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** grading.ts checkMatchingPart: list membership or strict equality. */
function matchesPart(candidate: unknown, correctPart: unknown): boolean {
  if (Array.isArray(correctPart)) return correctPart.includes(candidate);
  return candidate === correctPart;
}

const WRONG_TEXT = '@@definitely-wrong@@';

export function deriveQuestion(
  question: QuizQuestion,
  check: Record<string, unknown>,
): DerivedQuestion {
  const type = question.type;
  const notes: string[] = [];

  if (type === 'text_only_question' || type === 'essay_question') {
    return {
      correct: type === 'essay_question' ? 'A thoughtful response.' : '',
      alwaysCorrect: true,
      notes,
    };
  }

  if (type === 'true_false_question') {
    const raw = check['correct'];
    const expected =
      raw === true
        ? 'true'
        : raw === false
          ? 'false'
          : typeof raw === 'string'
            ? raw.toLowerCase()
            : null;
    if (expected !== 'true' && expected !== 'false') {
      return { underivable: `true_false check.correct is ${JSON.stringify(raw)}`, notes };
    }
    return { correct: expected, wrong: expected === 'true' ? 'false' : 'true', notes };
  }

  if (type === 'multiple_choice_question') {
    const field = check['correct'];
    const correct = firstString(field);
    if (correct === null) {
      return { underivable: 'multiple_choice check.correct missing', notes };
    }
    const options = Array.isArray(question.answers) ? question.answers : [];
    if (options.length > 0 && !options.includes(correct)) {
      notes.push(`correct value ${JSON.stringify(correct)} is not among the answer options`);
    }
    const accepted = (candidate: string) =>
      Array.isArray(field) ? field.includes(candidate) : candidate === field;
    const wrong = options.find((option) => !accepted(option));
    return { correct, ...(wrong !== undefined ? { wrong } : {}), notes };
  }

  if (type === 'multiple_answers_question') {
    const options = Array.isArray(question.answers) ? question.answers : [];
    const correctAnswers = Array.isArray(check['correct']) ? (check['correct'] as unknown[]) : null;
    if (correctAnswers === null) {
      return { underivable: 'multiple_answers check.correct missing', notes };
    }
    const known = correctAnswers.filter(
      (entry): entry is string => typeof entry === 'string' && options.includes(entry),
    );
    const unknown = correctAnswers.filter(
      (entry) => typeof entry === 'string' && !options.includes(entry as string),
    );
    if (unknown.length > 0) {
      notes.push(`correct entries not among options: ${JSON.stringify(unknown)}`);
    }
    // Grading compares SET equality restricted to known options.
    const wrong = known.length > 0 ? [] : options.length > 0 ? [options[0] as string] : undefined;
    return { correct: known, ...(wrong !== undefined ? { wrong } : {}), notes };
  }

  if (type === 'matching_question') {
    const correctList = Array.isArray(check['correct']) ? (check['correct'] as unknown[]) : null;
    if (correctList === null) {
      return { underivable: 'matching check.correct missing', notes };
    }
    const options = Array.isArray(question.answers) ? question.answers : [];
    const correct: string[] = [];
    for (const part of correctList) {
      const value = firstString(part);
      if (value === null) {
        return {
          underivable: `matching correct entry ${JSON.stringify(part)} not a string`,
          notes,
        };
      }
      if (options.length > 0 && !options.includes(value)) {
        notes.push(`matching correct value ${JSON.stringify(value)} not among options`);
      }
      correct.push(value);
    }
    // Wrong = a REAL option that does not match, per statement (the UI
    // walker needs selectable values); fall back to another statement's
    // answer, else no wrong derivable for that slot.
    const wrong = correctList.map((part, index) => {
      const fromOptions = options.find((option) => !matchesPart(option, part));
      if (fromOptions !== undefined) return fromOptions;
      const other = correct.find(
        (value, otherIndex) => otherIndex !== index && !matchesPart(value, part),
      );
      return other ?? correct[index]!;
    });
    const wrongDiffers = wrong.some((value, index) => !matchesPart(value, correctList[index]));
    return { correct, ...(wrongDiffers ? { wrong } : {}), notes };
  }

  if (type === 'multiple_dropdowns_question') {
    const correctMap = asRecord(check['correct']);
    const blanks = Object.keys(correctMap);
    if (blanks.length === 0) {
      return { underivable: 'multiple_dropdowns check.correct empty', notes };
    }
    const optionMap = asRecord(question.answers);
    const correct: Record<string, string> = {};
    const wrong: Record<string, string> = {};
    let anyWrong = false;
    for (const blank of blanks) {
      const value = firstString(correctMap[blank]);
      if (value === null) {
        return { underivable: `dropdown blank ${blank} correct not a string`, notes };
      }
      correct[blank] = value;
      const options = Array.isArray(optionMap[blank]) ? (optionMap[blank] as string[]) : [];
      if (options.length > 0 && !options.includes(value)) {
        notes.push(`dropdown ${blank} correct ${JSON.stringify(value)} not among options`);
      }
      const alternative = options.find((option) => option !== value);
      wrong[blank] = alternative ?? value;
      if (alternative !== undefined) anyWrong = true;
    }
    return { correct, ...(anyWrong ? { wrong } : {}), notes };
  }

  if (type === 'short_answer_question' || type === 'numerical_question') {
    if ('correct' in check || 'correct_exact' in check) {
      const value = firstString(check['correct'] ?? check['correct_exact']);
      if (value === null) {
        return { underivable: 'short_answer correct/correct_exact not a string', notes };
      }
      return { correct: value, wrong: WRONG_TEXT, notes };
    }
    if ('correct_regex' in check) {
      // A matching input cannot be synthesized from a regex in general.
      return { underivable: 'short_answer graded by correct_regex only', wrong: WRONG_TEXT, notes };
    }
    return { underivable: 'short_answer check has no correct field', notes };
  }

  if (type === 'fill_in_multiple_blanks_question') {
    if ('correct' in check || 'correct_exact' in check) {
      const map = asRecord(check['correct'] ?? check['correct_exact']);
      const correct: Record<string, string> = {};
      const wrong: Record<string, string> = {};
      for (const [blank, value] of Object.entries(map)) {
        const first = firstString(value);
        if (first === null) {
          return { underivable: `blank ${blank} correct not a string`, notes };
        }
        correct[blank] = first;
        wrong[blank] = WRONG_TEXT;
      }
      if (Object.keys(correct).length === 0) {
        return { underivable: 'fill_in_blanks correct map empty', notes };
      }
      return { correct, wrong, notes };
    }
    if ('correct_regex' in check) {
      return { underivable: 'fill_in_blanks graded by correct_regex only', notes };
    }
    return { underivable: 'fill_in_blanks check has no correct field', notes };
  }

  return { underivable: `unsupported question type ${type}`, notes };
}

export interface DerivedQuiz {
  /** Full-credit submission over the given question ids. */
  correctAnswers: Record<QuestionId, StudentAnswer>;
  /** Deliberately-wrong submission (only questions that CAN be wrong). */
  wrongAnswers: Record<QuestionId, StudentAnswer>;
  /** True when at least one presented question can grade incorrect. */
  anyWrongPossible: boolean;
  /** questionId → reason for every underivable correct answer. */
  underivable: Record<QuestionId, string>;
  /** Authoring smells, prefixed with the question id. */
  notes: string[];
}

export function deriveQuiz(
  instructions: QuizInstructions,
  checks: QuizChecksDocument,
  visible: ReadonlySet<QuestionId>,
): DerivedQuiz {
  const derived: DerivedQuiz = {
    correctAnswers: {},
    wrongAnswers: {},
    anyWrongPossible: false,
    underivable: {},
    notes: [],
  };
  const checkMap = checks.questions ?? {};
  for (const [questionId, question] of Object.entries(instructions.questions ?? {})) {
    if (!visible.has(questionId)) continue;
    const result = deriveQuestion(question, asRecord(checkMap[questionId]));
    for (const note of result.notes) derived.notes.push(`${questionId}: ${note}`);
    if (result.underivable !== undefined) {
      derived.underivable[questionId] = result.underivable;
      continue;
    }
    if (result.correct !== undefined) derived.correctAnswers[questionId] = result.correct;
    if (result.wrong !== undefined && !result.alwaysCorrect) {
      derived.wrongAnswers[questionId] = result.wrong;
      derived.anyWrongPossible = true;
    } else if (result.correct !== undefined) {
      // Questions that cannot be wrong still need an answer present in the
      // wrong-pass submission, or LD-35 grading would count them absent.
      derived.wrongAnswers[questionId] = result.correct;
    }
  }
  return derived;
}
