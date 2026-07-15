/**
 * Quiz authoring validation - a TypeScript port of the latest quiz
 * checking engine (bakery-exams src/formats/quizzes/quiz_check.py
 * `IssueTracker`, read 2026-07-11). The visual editor runs this live so
 * instructors see per-field issues as they type; severities follow the
 * source (error/warning).
 *
 * Latest-engine fields covered beyond the A3 freeze: `correct_any`
 * (accepted-but-ungraded), learning-objective tag aliases, answer-id
 * charset rules, regex compilation checks, `example`/`examples`
 * verification against the regexes, matching feedback in BOTH shapes
 * (server list-form and bakery statement-dict form), and the per-blank
 * rich fill-in feedback grammar.
 */
import { getBracketed } from './documents';
import type { QuizInstructions, QuizQuestion } from './types';
import type { QuizChecksDocument } from './grading';

export const QUESTION_TYPES = [
  'true_false_question',
  'matching_question',
  'multiple_choice_question',
  'multiple_answers_question',
  'multiple_dropdowns_question',
  'short_answer_question',
  'numerical_question',
  'fill_in_multiple_blanks_question',
  'text_only_question',
  'essay_question',
] as const;

/** quiz_check.py:914-922 - every field that lives in the checks document. */
export const FEEDBACK_FIELDS = [
  'correct',
  'correct_exact',
  'correct_regex',
  'correct_any',
  'wrong',
  'wrong_any',
  'feedback',
] as const;

/** quiz_check.py:139-165 - accepted learning-objective aliases. */
export const TAG_FIELDS = [
  'learning_objective',
  'lo',
  'loid',
  'learning_objectives',
  'loids',
  'los',
  'readings',
  'reading_ids',
  'tags',
] as const;

const VALID_ANSWER_ID = /^[a-zA-Z0-9_-]+$/;

export interface QuizIssue {
  message: string;
  questionId: string;
  field: string;
  severity: 'error' | 'warning';
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isDictOfStrings = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every(isString);
const isDictOfStringLists = (value: unknown): value is Record<string, string[]> =>
  isRecord(value) && Object.values(value).every(isStringList);

function regexError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return String(error);
  }
}

/** The authored question + its check fields merged (the bakery shape). */
export type MergedQuestion = Record<string, unknown>;

export class QuizIssueTracker {
  issues: QuizIssue[] = [];

  add(message: string, questionId: string, field: string, severity: 'error' | 'warning' = 'error') {
    this.issues.push({ message, questionId, field, severity });
  }

  private anyOtherFeedbackFields(question: MergedQuestion, allowed: string[], name: string) {
    for (const field of FEEDBACK_FIELDS) {
      if (field in question && !allowed.includes(field)) {
        this.add(
          `Feedback field \`${field}\` is not allowed for this question type. Use one of ${JSON.stringify(allowed)} instead.`,
          name,
          field,
        );
      }
    }
  }

  private checkLearningObjectives(name: string, question: MergedQuestion) {
    const found = TAG_FIELDS.find((field) => field in question);
    if (found !== undefined) {
      const value = question[found];
      if (!isString(value) && !isStringList(value)) {
        this.add(`The \`${found}\` field must be a string or a list of strings.`, name, found);
      }
    }
  }

  private checkMainFields(name: string, question: MergedQuestion) {
    for (const field of ['body', 'type']) {
      if (!(field in question)) {
        this.add(`Missing required \`${field}\` field`, name, field);
      }
    }
    if (!('points' in question)) {
      if ('type' in question && question['type'] !== 'text_only_question') {
        this.add('Missing `points` field', name, 'points', 'warning');
      }
    } else if (typeof question['points'] !== 'number') {
      this.add('The `points` field must be a number.', name, 'points');
    }
    if (
      'type' in question &&
      !QUESTION_TYPES.includes(question['type'] as (typeof QUESTION_TYPES)[number])
    ) {
      this.add(
        `Invalid question type \`${String(question['type'])}\`. Must be one of ${JSON.stringify(QUESTION_TYPES)}`,
        name,
        'type',
      );
    }
    if ('body' in question && !isString(question['body'])) {
      this.add('The `body` field must be a string.', name, 'body');
    }
  }

  private checkRetainOrder(name: string, question: MergedQuestion) {
    if (
      question['type'] === 'matching_question' ||
      question['type'] === 'multiple_dropdowns_question'
    ) {
      if ('retainOrder' in question && typeof question['retainOrder'] !== 'boolean') {
        this.add('The `retainOrder` field must be a boolean.', name, 'retainOrder');
      }
    } else if ('retainOrder' in question) {
      this.add(
        'The `retainOrder` field is only valid for matching_question and multiple_dropdowns_question.',
        name,
        'retainOrder',
        'warning',
      );
    }
  }

  private checkStatements(name: string, question: MergedQuestion): boolean {
    if (question['type'] === 'matching_question') {
      if (!('statements' in question)) {
        this.add('Missing `statements` field', name, 'statements');
        return false;
      } else if (!isStringList(question['statements'])) {
        this.add('The `statements` field must be a list of strings', name, 'statements');
        return false;
      }
    } else if ('statements' in question) {
      this.add(
        'The `statements` field is only valid for matching_question.',
        name,
        'statements',
        'warning',
      );
    }
    return true;
  }

  private checkAnswers(name: string, question: MergedQuestion): boolean {
    const type = question['type'];
    if (
      type === 'matching_question' ||
      type === 'multiple_choice_question' ||
      type === 'multiple_answers_question'
    ) {
      if (!('answers' in question)) {
        this.add('Missing `answers` field', name, 'answers');
        return false;
      } else if (!isStringList(question['answers'])) {
        this.add(
          'The `answers` field must be a list of strings or list of list of strings (for alternative answers).',
          name,
          'answers',
        );
        return false;
      }
    } else if (type === 'multiple_dropdowns_question') {
      if (!('answers' in question)) {
        this.add('Missing `answers` field', name, 'answers');
        return false;
      } else if (!isDictOfStringLists(question['answers'])) {
        this.add(
          'The `answers` field must be a dictionary mapping the Answer IDs to a list of the correct answers.',
          name,
          'answers',
        );
        return false;
      }
    } else if ('answers' in question) {
      this.add(
        `The \`answers\` field is not valid for ${String(type)} questions.`,
        name,
        'answers',
        'warning',
      );
    }
    return true;
  }

  checkQuizQuestion(name: string, question: MergedQuestion) {
    this.checkMainFields(name, question);
    this.checkLearningObjectives(name, question);
    if (!('type' in question)) return;
    this.checkRetainOrder(name, question);
    const statementsGood = this.checkStatements(name, question);
    const answersGood = this.checkAnswers(name, question);
    if (!statementsGood || !answersGood) return;
    this.checkFeedback(name, question);
  }

  private checkFeedback(name: string, question: MergedQuestion) {
    const type = question['type'];
    const body = isString(question['body']) ? question['body'] : '';

    if (type === 'true_false_question') {
      if (!('correct' in question)) {
        this.add(
          'Missing `correct` field to indicate whether the statement is true or false.',
          name,
          'correct',
        );
      } else if (typeof question['correct'] !== 'boolean') {
        this.add(
          `The \`correct\` field must be a boolean, not ${JSON.stringify(question['correct'])}.`,
          name,
          'correct',
        );
      }
      if ('wrong' in question && !isString(question['wrong'])) {
        this.add('The `wrong` field must be a string.', name, 'wrong');
      }
      this.anyOtherFeedbackFields(question, ['correct', 'wrong'], name);
    }

    if (type === 'matching_question') {
      const statements = (question['statements'] ?? []) as string[];
      const answers = (question['answers'] ?? []) as string[];
      if (!('correct' in question)) {
        this.add(
          'Missing `correct` field to indicate the correct answers (list of strings).',
          name,
          'correct',
        );
        return;
      }
      const correct = question['correct'];
      if (!Array.isArray(correct)) {
        this.add('The `correct` field must be a list of strings.', name, 'correct');
        return;
      }
      if (correct.length !== statements.length) {
        this.add(
          `The number of statements and correct answers is not the same (${statements.length} vs ${correct.length}).`,
          name,
          'correct',
        );
      }
      for (const entry of correct) {
        if (isString(entry)) {
          if (!answers.includes(entry)) {
            this.add(
              `A correct answer is not in the list of possible answers (${entry}).`,
              name,
              'correct',
            );
          }
        } else if (isStringList(entry)) {
          for (const possible of entry) {
            if (!answers.includes(possible)) {
              this.add(
                `A correct answer is not in the list of possible answers (${possible}).`,
                name,
                'correct',
              );
            }
          }
        } else {
          this.add('The `correct` field must be a string or a list of strings.', name, 'correct');
        }
      }
      const feedback = question['feedback'];
      if (feedback !== undefined) {
        if (isDictOfStrings(feedback)) {
          // Bakery statement-keyed form (quiz_check.py:343-357).
          for (const statement of Object.keys(feedback)) {
            if (!statements.includes(statement)) {
              this.add(
                `A feedback statement does not match any of the statements (${statement}).`,
                name,
                'feedback',
              );
            }
          }
        } else if (Array.isArray(feedback)) {
          // Server statement-ordered list form (quizzes.py:115-117).
          if (feedback.length !== statements.length) {
            this.add(
              `The feedback list must match the number of statements (${statements.length} vs ${feedback.length}).`,
              name,
              'feedback',
              'warning',
            );
          }
        } else {
          this.add(
            'The `feedback` field must be a dictionary mapping statements to feedback.',
            name,
            'feedback',
          );
        }
      }
    }

    if (type === 'multiple_choice_question') {
      const answers = (question['answers'] ?? []) as string[];
      const correct = question['correct'];
      if (correct === undefined) {
        this.add(
          'Missing `correct` field to indicate the correct answer (list of strings).',
          name,
          'correct',
        );
      } else if (isString(correct)) {
        if (!answers.includes(correct)) {
          this.add('The correct answer is not in the list of answers.', name, 'correct');
        }
      } else if (isStringList(correct)) {
        if (!correct.some((entry) => answers.includes(entry))) {
          this.add('None of the correct answers are in the list of answers.', name, 'correct');
        } else {
          for (const entry of correct) {
            if (!answers.includes(entry)) {
              this.add(
                `A correct answer is not in the list of answers (${entry}).`,
                name,
                'correct',
                'warning',
              );
            }
          }
        }
      } else {
        this.add('The `correct` field must be a string or a list of strings.', name, 'correct');
      }
      const feedback = question['feedback'];
      if (feedback !== undefined) {
        if (isDictOfStrings(feedback)) {
          for (const answer of Object.keys(feedback)) {
            if (!answers.includes(answer)) {
              this.add(
                `A feedback answer is not in the list of answers (${answer}).`,
                name,
                'feedback',
              );
            }
          }
        } else {
          this.add(
            'The `feedback` field must be a dictionary mapping answers to feedback.',
            name,
            'feedback',
          );
        }
      }
    }

    if (type === 'multiple_answers_question') {
      const answers = (question['answers'] ?? []) as string[];
      const correct = question['correct'];
      if (correct === undefined) {
        this.add(
          'Missing `correct` field to indicate the list of correct answers.',
          name,
          'correct',
        );
      } else if (!isStringList(correct)) {
        this.add('The `correct` field must be a list of strings.', name, 'correct');
      } else {
        for (const answer of correct) {
          if (!answers.includes(answer)) {
            this.add(
              `A correct answer is not in the list of answers (${answer}).`,
              name,
              'correct',
            );
          }
        }
      }
      const wrong = question['wrong'];
      if (wrong !== undefined) {
        if (!Array.isArray(wrong) || !wrong.every((entry) => entry === null || isString(entry))) {
          this.add('The `wrong` field must be a list of strings.', name, 'wrong');
        } else if (wrong.length !== answers.length) {
          this.add(
            'The `wrong` field must have the same number of items as the `answers` field.',
            name,
            'wrong',
          );
        }
      }
      if ('wrong_any' in question && !isString(question['wrong_any'])) {
        this.add('The `wrong_any` field must be a string.', name, 'wrong_any');
      }
    }

    if (type === 'multiple_dropdowns_question') {
      const answers = (question['answers'] ?? {}) as Record<string, string[]>;
      const correct = question['correct'];
      const answerIds = getBracketed(body);
      if (correct === undefined) {
        this.add(
          'Missing `correct` field to indicate the correct answers for each answer ID.',
          name,
          'correct',
        );
      } else if (isDictOfStrings(correct)) {
        for (const answerId of answerIds) {
          if (!VALID_ANSWER_ID.test(answerId)) {
            this.add(
              `Invalid answer ID \`${answerId}\`. Answer IDs must only contain letters, numbers, and underscores.`,
              name,
              'correct',
            );
          }
          if (!(answerId in correct)) {
            this.add(
              `Answer ID \`${answerId}\` found in the body of the question does not have a correct answer.`,
              name,
              'correct',
            );
          }
        }
        for (const answerId of Object.keys(correct)) {
          if (!VALID_ANSWER_ID.test(answerId)) {
            this.add(
              `Invalid answer ID \`${answerId}\` in the \`correct\` field. Answer IDs must only contain letters, numbers, and underscores.`,
              name,
              'correct',
            );
          }
          if (!answerIds.includes(answerId)) {
            this.add(
              `Answer ID \`${answerId}\` does not match any of the identifiers in the body of the question.`,
              name,
              'correct',
            );
          }
        }
      } else {
        this.add(
          'The `correct` field must be a dictionary mapping answer IDs to the correct answer.',
          name,
          'correct',
        );
      }
      if ('wrong_any' in question && !isString(question['wrong_any'])) {
        this.add('The `wrong_any` field must be a string.', name, 'wrong_any');
      }
      const feedback = question['feedback'];
      if (feedback !== undefined) {
        if (!isRecord(feedback)) {
          this.add(
            'The `feedback` field must be a dictionary mapping answer IDs to feedback strings, or to a dictionary mapping possible answers to feedback strings.',
            name,
            'feedback',
          );
        } else {
          const covered = new Set<string>();
          for (const [answerId, entry] of Object.entries(feedback)) {
            if (!VALID_ANSWER_ID.test(answerId)) {
              this.add(
                `Invalid answer ID \`${answerId}\` in the \`feedback\` field. Answer IDs must only contain letters, numbers, and underscores.`,
                name,
                'feedback',
              );
            }
            if (!answerIds.includes(answerId)) {
              this.add(
                `Answer ID \`${answerId}\` does not match any of the identifiers in the body of the question.`,
                name,
                'feedback',
              );
            }
            covered.add(answerId);
            if (isString(entry)) continue;
            if (isRecord(entry)) {
              const options = answers[answerId] ?? [];
              const optionsCovered = new Set<string>();
              for (const [possible, message] of Object.entries(entry)) {
                if (!options.includes(possible)) {
                  this.add(
                    `A feedback possible answer (${possible}) is not in the list of answers for ${answerId}.`,
                    name,
                    'feedback',
                  );
                }
                if (!isString(message)) {
                  this.add(
                    `The feedback string must be a string in ${possible} for ${answerId}.`,
                    name,
                    'feedback',
                  );
                }
                optionsCovered.add(possible);
              }
              const missing = options.filter((option) => !optionsCovered.has(option));
              if (missing.length) {
                this.add(
                  `A dictionary of possible answers for ${answerId} was provided for feedback, but it does not cover the following answers: ${JSON.stringify(missing)}`,
                  name,
                  'feedback',
                  'warning',
                );
              }
            } else {
              this.add(
                `The \`feedback\` field for ${answerId} was a dictionary, and had valid answer IDs, but the feedback values were not strings or dictionaries mapping strings to strings.`,
                name,
                'feedback',
              );
            }
          }
          const missingIds = answerIds.filter((answerId) => !covered.has(answerId));
          if (missingIds.length) {
            this.add(
              `The \`feedback\` field does not cover the following answer IDs found in the body of the question: ${JSON.stringify(missingIds)}`,
              name,
              'feedback',
              'warning',
            );
          }
        }
      }
    } else if (type === 'short_answer_question' || type === 'numerical_question') {
      if (
        !('correct' in question) &&
        !('correct_exact' in question) &&
        !('correct_regex' in question)
      ) {
        this.add(
          'Missing `correct`, `correct_exact`, or `correct_regex` field to indicate the correct answer.',
          name,
          'correct',
        );
      }
      if ('correct' in question || 'correct_exact' in question) {
        const correct = question['correct'] ?? question['correct_exact'];
        if (!isString(correct) && !isStringList(correct)) {
          this.add('The `correct` field must be a string or a list of strings.', name, 'correct');
        }
        if ('feedback' in question && !isDictOfStrings(question['feedback'])) {
          this.add(
            'The `feedback` field must be a dictionary mapping exact answers to feedback.',
            name,
            'feedback',
          );
        }
      } else if ('correct_regex' in question) {
        const regexes = question['correct_regex'];
        if (!isStringList(regexes)) {
          this.add(
            'The `correct_regex` field must be a list of regex strings.',
            name,
            'correct_regex',
          );
        } else {
          for (const pattern of regexes) {
            const failure = regexError(pattern);
            if (failure) {
              this.add(
                `Invalid regex in the \`correct_regex\` field: ${pattern}\n${failure}`,
                name,
                'correct_regex',
              );
            }
          }
        }
        if ('feedback' in question) {
          if (!isDictOfStrings(question['feedback'])) {
            this.add(
              'The `feedback` field must be a dictionary mapping regex strings to feedback strings.',
              name,
              'feedback',
            );
          } else {
            for (const pattern of Object.keys(question['feedback'] as Record<string, string>)) {
              const failure = regexError(pattern);
              if (failure) {
                this.add(
                  `Invalid regex in the \`feedback\` field: ${pattern}\n${failure}`,
                  name,
                  'feedback',
                );
              }
            }
          }
        }
      }
      if ('wrong_any' in question && !isString(question['wrong_any'])) {
        this.add('The `wrong_any` field must be a string.', name, 'wrong_any');
      }
    } else if (type === 'fill_in_multiple_blanks_question') {
      const answerIds = getBracketed(body);
      if (
        !('correct' in question) &&
        !('correct_exact' in question) &&
        !('correct_regex' in question)
      ) {
        this.add(
          'Missing `correct`, `correct_exact`, or `correct_regex` field to indicate the correct answers.',
          name,
          'correct',
        );
      }
      if ('correct' in question || 'correct_exact' in question) {
        const correct = question['correct'] ?? question['correct_exact'];
        if (
          !isRecord(correct) ||
          !Object.values(correct).every((entry) => isString(entry) || isStringList(entry))
        ) {
          this.add(
            'The `correct` field must be a dictionary mapping Answer IDs to the correct answers (either strings or list of strings).',
            name,
            'correct',
          );
        } else {
          for (const answerId of answerIds) {
            if (!VALID_ANSWER_ID.test(answerId)) {
              this.add(
                `Invalid answer ID \`${answerId}\` found in body. Answer IDs must only contain letters, numbers, and underscores.`,
                name,
                'body',
              );
            }
            if (!(answerId in correct)) {
              this.add(
                `Answer ID \`${answerId}\` found in the body of the question does not have a correct answer.`,
                name,
                'correct',
              );
            }
          }
          for (const answerId of Object.keys(correct)) {
            if (!VALID_ANSWER_ID.test(answerId)) {
              this.add(
                `Invalid answer ID \`${answerId}\`. Answer IDs must only contain letters, numbers, and underscores.`,
                name,
                'correct',
              );
            }
            if (!answerIds.includes(answerId)) {
              this.add(
                `Answer ID \`${answerId}\` does not match any of the identifiers in the body of the question.`,
                name,
                'correct',
              );
            }
          }
        }
      } else if ('correct_regex' in question) {
        const regexMap = question['correct_regex'];
        if (!isDictOfStringLists(regexMap)) {
          this.add(
            'The `correct_regex` field must be a dictionary mapping Answer IDs to a list of regex strings.',
            name,
            'correct_regex',
          );
        } else {
          for (const [answerId, regexes] of Object.entries(regexMap)) {
            if (!VALID_ANSWER_ID.test(answerId)) {
              this.add(
                `Invalid answer ID \`${answerId}\`. Answer IDs must only contain letters, numbers, and underscores.`,
                name,
                'correct',
              );
            }
            if (!answerIds.includes(answerId)) {
              this.add(
                `Answer ID \`${answerId}\` does not match any of the identifiers in the body of the question.`,
                name,
                'correct',
              );
            }
            for (const pattern of regexes) {
              const failure = regexError(pattern);
              if (failure) {
                this.add(
                  `Invalid regex in the \`correct_regex\` field: ${pattern}\n${failure}`,
                  name,
                  'correct_regex',
                );
              }
            }
          }
          for (const answerId of answerIds) {
            if (!(answerId in regexMap)) {
              this.add(
                `Answer ID \`${answerId}\` found in the body of the question does not have a correct answer.`,
                name,
                'correct',
              );
            }
          }
        }
      }
      // The server's rich fill-in feedback iteration is broken in python
      // (quizzes.py:202) - REMOTE grading only honors strings reliably.
      if ('feedback' in question) {
        this.add(
          'Rich per-blank `feedback` grades correctly in local Try It, but the CURRENT server build crashes on it (quizzes.py:202) - prefer `wrong_any` until the server updates.',
          name,
          'feedback',
          'warning',
        );
      }
      if ('wrong_any' in question && !isString(question['wrong_any'])) {
        this.add('The `wrong_any` field must be a string.', name, 'wrong_any');
      }
    } else if (type === 'text_only_question' || type === 'essay_question') {
      if (FEEDBACK_FIELDS.some((field) => field in question)) {
        this.add(
          'Feedback fields are not allowed for text_only_question and essay_question.',
          name,
          'feedback',
        );
      }
    }
  }
}

/** Merge instructions question + its check fields (the bakery merged shape
 *  the validator understands) and run every question through the tracker. */
export function validateQuiz(
  instructions: QuizInstructions,
  checks: QuizChecksDocument,
): QuizIssue[] {
  const tracker = new QuizIssueTracker();
  const checkMap = checks.questions ?? {};
  for (const [questionId, question] of Object.entries(instructions.questions ?? {})) {
    const merged: MergedQuestion = {
      ...(question as QuizQuestion),
      ...(checkMap[questionId] ?? {}),
    };
    delete merged['id'];
    tracker.checkQuizQuestion(questionId, merged);
  }
  // Orphaned checks (quiz.py:119 TODO - surfaced here).
  for (const questionId of Object.keys(checkMap)) {
    if (!(instructions.questions ?? {})[questionId]) {
      tracker.add(
        'This check has no matching question in the instructions document.',
        questionId,
        'type',
        'warning',
      );
    }
  }
  // Pool references (authoring-level sanity).
  for (const pool of instructions.pools ?? []) {
    for (const questionId of pool.questions) {
      if (!(instructions.questions ?? {})[questionId]) {
        tracker.add(
          `Pool "${pool.name}" references a question that does not exist.`,
          questionId,
          'pools',
        );
      }
    }
    if (pool.amount > pool.questions.length) {
      tracker.add(
        `Pool "${pool.name}" wants ${pool.amount} questions but only has ${pool.questions.length}.`,
        pool.name,
        'pools',
        'warning',
      );
    }
  }
  return tracker.issues;
}
