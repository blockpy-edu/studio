/**
 * Local quiz grading engine — a TypeScript port of the SERVER grader
 * (blockpy-server models/data_formats/quizzes.py `process_quiz` /
 * `check_quiz_question`, read 2026-07-11), so the instructor's "Try It"
 * panel can grade drafts instantly without a round trip. The remote path
 * (updateSubmission → regrade_if_quiz) stays the authority; this port
 * replicates its observable behavior quirk-for-quirk where safe:
 *
 *   - true/false compares `str(check.correct).lower()` against the answer;
 *   - matching zips statement-ordered lists; a list `correct` entry accepts
 *     any member; feedback entries are strings or {answer: message} maps
 *     (the bakery format also authors {statement: message} maps — treated
 *     per-statement here, which is what the zip degenerates to);
 *   - multiple answers score = matching-checkbox-count / options, correct =
 *     set equality restricted to known options, index-aligned `wrong`
 *     feedback for mismatched options, `wrong_any` fallback;
 *   - short answer/numerical: `correct`/`correct_exact` trimmed-submission
 *     exact match (string or list, quizzes.py→common/text.py:6-14), or
 *     `correct_regex` any-match — INCLUDING the server's feedback quirk of
 *     looking regex feedback up by the matched `correct_regex` entry;
 *   - fill-in-blanks: per-blank exact/regex; the server's rich `feedback`
 *     iteration is broken in python (dict unpacking, quizzes.py:202) — the
 *     port implements the DOCUMENTED intent (string | {regex: msg} |
 *     [{regex: msg}] per blank) and the validator flags the server gap;
 *   - `correct_any` (a newer authoring field, bakery FEEDBACK_FIELDS) is
 *     preserved by the editor but NOT graded — the server ignores it too;
 *   - essay/text-only always score 1; unknown types produce the
 *     "Unknown Type: …" error feedback; unanswered questions are skipped
 *     and their points excluded; empty quiz → correct=false.
 */
import type {
  QuestionId,
  QuizInstructions,
  QuizQuestion,
  QuizQuestionFeedback,
  QuizSubmission,
  StudentAnswer,
} from './types';

export interface QuizChecksDocument {
  questions?: Record<QuestionId, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface LocalQuizResult {
  /** Fraction 0..1 of the whole quiz. */
  score: number;
  correct: boolean;
  pointsPossible: number;
  feedbacks: Record<QuestionId, QuizQuestionFeedback>;
}

/** common/text.py:6-14 — trims the SUBMISSION only; list = membership. */
export function compareStringEquality(submitted: string, expected: unknown): boolean {
  if (!submitted && Boolean(expected)) return false;
  const trimmed = String(submitted).trim();
  if (typeof expected === 'string') return trimmed === expected;
  if (Array.isArray(expected)) return expected.includes(trimmed);
  return false;
}

/** Python re.match = anchored-at-start search. */
function reMatch(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).exec(value)?.index === 0;
  } catch {
    return false;
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

interface QuestionResult {
  score: number;
  correct: boolean;
  message: unknown;
}

function checkMatchingPart(studentPart: unknown, correctPart: unknown): boolean {
  if (Array.isArray(correctPart)) return correctPart.includes(studentPart);
  return studentPart === correctPart;
}

export function checkQuizQuestion(
  question: QuizQuestion,
  check: Record<string, unknown>,
  student: StudentAnswer,
): QuestionResult | null {
  const type = question.type;
  if (type === 'true_false_question') {
    const correct =
      String(student).toLowerCase() ===
      String(
        check['correct'] === true
          ? 'True'
          : check['correct'] === false
            ? 'False'
            : check['correct'],
      ).toLowerCase();
    return {
      score: correct ? 1 : 0,
      correct,
      message: !correct ? check['wrong'] : 'Correct',
    };
  } else if (type === 'matching_question') {
    const answers = (student ?? []) as Array<string | undefined | null>;
    const correctList = (check['correct'] ?? []) as unknown[];
    const pairCount = Math.min(answers.length, correctList.length);
    const corrects: boolean[] = [];
    for (let index = 0; index < pairCount; index += 1) {
      corrects.push(checkMatchingPart(answers[index], correctList[index]));
    }
    const feedbackSource = check['feedback'];
    const feedbacks: unknown[] = [];
    if (Array.isArray(feedbackSource)) {
      // Server shape: statement-ordered list (quizzes.py:115-117).
      const feedbackCount = Math.min(answers.length, feedbackSource.length);
      for (let index = 0; index < feedbackCount; index += 1) {
        const entry = feedbackSource[index];
        feedbacks.push(
          typeof entry === 'string' ? entry : (asRecord(entry)[String(answers[index])] ?? ''),
        );
      }
    } else if (feedbackSource && typeof feedbackSource === 'object') {
      // Bakery shape: {statement: message} — applied per statement.
      const statements = question.statements ?? [];
      statements.forEach((statement, index) => {
        if (index < answers.length) {
          feedbacks.push(asRecord(feedbackSource)[statement] ?? '');
        }
      });
    }
    const anyFeedback = feedbacks.some((entry) => Boolean(entry));
    // Python all([]) is True — an empty zip grades correct with score 0
    // (quizzes.py:118-119); JS [].every matches.
    const allCorrect = corrects.every(Boolean);
    const message = anyFeedback
      ? feedbacks.map((entry) => String(entry)).join('\n<br>')
      : allCorrect
        ? 'Correct'
        : 'Incorrect';
    return {
      score: corrects.length ? corrects.filter(Boolean).length / corrects.length : 0,
      correct: allCorrect,
      message,
    };
  } else if (type === 'multiple_choice_question') {
    const chosen = student as string;
    const correctField = check['correct'];
    const correct = Array.isArray(correctField)
      ? correctField.includes(chosen)
      : chosen === correctField;
    return {
      score: correct ? 1 : 0,
      correct,
      message: !correct ? (asRecord(check['feedback'])[chosen] ?? 'Incorrect') : 'Correct',
    };
  } else if (type === 'multiple_answers_question') {
    const options = (question.answers ?? []) as string[];
    const chosen = (student ?? []) as string[];
    const correctAnswers = (check['correct'] ?? []) as string[];
    const chosenKnown = new Set(chosen.filter((entry) => options.includes(entry)));
    const correctKnown = new Set(correctAnswers.filter((entry) => options.includes(entry)));
    const correct =
      chosenKnown.size === correctKnown.size &&
      [...chosenKnown].every((entry) => correctKnown.has(entry));
    const corrects = options.map(
      (option) => correctAnswers.includes(option) === chosen.includes(option),
    );
    let feedbacks: string | string[] = [];
    if ('wrong' in check && Array.isArray(check['wrong'])) {
      feedbacks = (check['wrong'] as Array<string | null>)
        .filter((entry, index) => !corrects[index] && entry)
        .map((entry) => String(entry));
    }
    let message: unknown;
    if (!correct && (feedbacks as string[]).length === 0) {
      message = check['wrong_any'] ?? 'Incorrect';
    } else {
      message = (feedbacks as string[]).join('<br>\n');
    }
    return {
      score: options.length ? corrects.filter(Boolean).length / options.length : 0,
      correct,
      message: correct ? 'Correct' : message,
    };
  } else if (type === 'multiple_dropdowns_question') {
    const chosen = asRecord(student);
    const correctMap = asRecord(check['correct']);
    const corrects: boolean[] = [];
    const feedbacks: string[] = [];
    for (const [blankId, answer] of Object.entries(correctMap)) {
      const isCorrect = chosen[blankId] === answer;
      corrects.push(isCorrect);
      if (!isCorrect) {
        let feedback = asRecord(check['feedback'])[blankId];
        if (feedback && typeof feedback === 'object' && !Array.isArray(feedback)) {
          feedback = asRecord(feedback)[String(chosen[blankId])];
        }
        if (feedback) feedbacks.push(String(feedback));
      }
    }
    const allCorrect = corrects.every(Boolean);
    const message = allCorrect
      ? 'Correct'
      : feedbacks.length === 0
        ? (check['wrong_any'] ?? 'Incorrect')
        : feedbacks.join('<br>\n');
    return {
      score: corrects.length ? corrects.filter(Boolean).length / corrects.length : 0,
      correct: allCorrect,
      message,
    };
  } else if (type === 'short_answer_question' || type === 'numerical_question') {
    const answer = String(student ?? '');
    const wrongAny = check['wrong_any'] ?? 'Incorrect';
    let correct: boolean;
    let feedback: unknown;
    if ('correct' in check) {
      correct = compareStringEquality(answer, check['correct']);
      feedback = asRecord(check['feedback'])[answer] ?? wrongAny;
    } else if ('correct_exact' in check) {
      correct = compareStringEquality(answer, check['correct_exact']);
      feedback = asRecord(check['feedback'])[answer] ?? wrongAny;
    } else if ('correct_regex' in check) {
      const regexes = (check['correct_regex'] ?? []) as string[];
      correct = regexes.some((pattern) => reMatch(pattern, answer));
      // Server quirk (quizzes.py:176-178): regex feedback is looked up by
      // the MATCHED correct_regex entry, not the feedback keys.
      const matched = regexes
        .filter((pattern) => reMatch(pattern, answer))
        .map((pattern) => asRecord(check['feedback'])[pattern]);
      feedback = matched.length ? (matched[0] ?? '') : wrongAny;
    } else {
      return {
        score: 0,
        correct: false,
        message: 'Unknown Short Answer Question Check: ' + JSON.stringify(check),
      };
    }
    return { score: correct ? 1 : 0, correct, message: !correct ? feedback : 'Correct' };
  } else if (type === 'fill_in_multiple_blanks_question') {
    const chosen = asRecord(student) as Record<string, string>;
    let corrects: Record<string, boolean>;
    if ('correct' in check || 'correct_exact' in check) {
      const correctMap = asRecord(check['correct'] ?? check['correct_exact']);
      corrects = Object.fromEntries(
        Object.entries(correctMap).map(([blankId, answer]) => [
          blankId,
          compareStringEquality(chosen[blankId] ?? '', answer),
        ]),
      );
    } else if ('correct_regex' in check) {
      const regexMap = asRecord(check['correct_regex']);
      corrects = Object.fromEntries(
        Object.entries(regexMap).map(([blankId, regexes]) => [
          blankId,
          ((regexes ?? []) as string[]).some((pattern) => reMatch(pattern, chosen[blankId] ?? '')),
        ]),
      );
    } else {
      return {
        score: 0,
        correct: false,
        message: 'Unknown Fill In Multiple Blanks Question Check: ' + JSON.stringify(check),
      };
    }
    const values = Object.values(corrects);
    const allCorrect = values.every(Boolean);
    const wrongAny = check['wrong_any'] ?? 'Incorrect';
    let message: unknown;
    if ('feedback' in check) {
      // Documented intent (broken server-side, quizzes.py:202): per-blank
      // string | {regex: msg} | [{regex: msg}] applied to wrong blanks.
      const feedbacks: string[] = [];
      for (const [blankId, rawFeedback] of Object.entries(asRecord(check['feedback']))) {
        if (corrects[blankId]) continue;
        if (typeof rawFeedback === 'string') {
          feedbacks.push(rawFeedback);
          continue;
        }
        const entries = Array.isArray(rawFeedback) ? rawFeedback : [rawFeedback];
        let found = false;
        for (const entry of entries) {
          for (const [pattern, msg] of Object.entries(asRecord(entry))) {
            if (reMatch(pattern, chosen[blankId] ?? '')) {
              feedbacks.push(String(msg));
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
      message = feedbacks.length ? feedbacks.join('<br>\n') : allCorrect ? 'Correct' : wrongAny;
    } else {
      message = allCorrect ? 'Correct' : wrongAny;
    }
    return {
      score: values.length ? values.filter(Boolean).length / values.length : 0,
      correct: allCorrect,
      message,
    };
  } else if (type === 'text_only_question' || type === 'essay_question') {
    return { score: 1, correct: true, message: 'Correct' };
  }
  return null; // unknown type → "Unknown Type" feedback upstream
}

/** process_quiz (quizzes.py:58-99): grades every ANSWERED question; missing
 *  answers are skipped and their points excluded; nothing checked ⇒ false. */
export function processQuiz(
  instructions: QuizInstructions,
  checks: QuizChecksDocument,
  submission: QuizSubmission,
): LocalQuizResult {
  const studentAnswers = submission.studentAnswers ?? {};
  const checkMap = checks.questions ?? {};
  const questions = instructions.questions ?? {};
  let totalScore = 0;
  let totalPoints = 0;
  let totalCorrect = true;
  let questionsChecked = 0;
  const feedbacks: Record<QuestionId, QuizQuestionFeedback> = {};
  for (const [questionId, question] of Object.entries(questions)) {
    const student = studentAnswers[questionId];
    if (student === undefined || student === null) continue;
    const check = asRecord(checkMap[questionId]);
    const points = typeof question.points === 'number' ? question.points : 1;
    totalPoints += points;
    const result = checkQuizQuestion(question, check, student);
    if (result === null) {
      feedbacks[questionId] = {
        message: 'Unknown Type: ' + question.type,
        correct: null,
        score: 0,
        status: 'error',
        tags: [],
      };
    } else {
      totalScore += result.score * points;
      totalCorrect = totalCorrect && result.correct;
      feedbacks[questionId] = {
        message: String(result.message),
        correct: result.correct,
        score: result.score,
        status: 'graded',
        tags: !result.correct ? ((question.tags ?? []) as string[]) : [],
      };
    }
    questionsChecked += 1;
  }
  if (!questionsChecked) totalCorrect = false;
  return {
    score: totalPoints ? totalScore / totalPoints : 0,
    correct: totalCorrect,
    pointsPossible: totalPoints,
    feedbacks,
  };
}
