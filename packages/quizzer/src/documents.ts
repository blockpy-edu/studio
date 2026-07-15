/**
 * Quiz document handling - ports of quiz.ts's parse/fill/serialize layer
 * (blockpy-server frontend/components/quizzes/quiz.ts) plus the seeded
 * randomness utilities (frontend/utilities/random.ts:1-29).
 */
import type {
  QuestionId,
  QuestionPool,
  QuizInstructions,
  QuizQuestion,
  QuizSubmission,
  StudentAnswer,
} from './types';

export const EMPTY_QUIZ_SUBMISSION: QuizSubmission = {
  attempt: { attempting: false, count: 0 },
  studentAnswers: {},
  feedback: {},
};

/** quiz.ts:83-96 - defaults without clobbering unknown fields. */
export function fillInMissingQuizSubmissionFields(doc: QuizSubmission): QuizSubmission {
  doc.studentAnswers ??= {};
  doc.feedback ??= {};
  doc.attempt ??= {};
  doc.attempt.attempting ??= false;
  doc.attempt.count ??= 0;
  doc.attempt.mulligans ??= 0;
  return doc;
}

/** quiz.ts:98-114 - note the backfill default poolRandomness is ATTEMPT
 *  (the empty template says SEED; A3 open q. 5 freezes the backfill). */
export function fillInMissingQuizInstructionFields(doc: QuizInstructions): QuizInstructions {
  doc.questions ??= {};
  doc.settings ??= {};
  doc.pools ??= [];
  doc.settings.attemptLimit ??= -1;
  doc.settings.coolDown ??= -1;
  doc.settings.feedbackType ??= 'IMMEDIATE';
  doc.settings.questionsPerPage ??= -1;
  doc.settings.poolRandomness ??= 'ATTEMPT';
  doc.settings.readingId ??= null;
  return doc;
}

export function parseQuizInstructions(raw: string): QuizInstructions {
  let doc: QuizInstructions;
  try {
    doc = JSON.parse(raw || '{}') as QuizInstructions;
  } catch {
    doc = {};
  }
  return fillInMissingQuizInstructionFields(doc);
}

export function parseQuizSubmission(raw: string): QuizSubmission {
  let doc: QuizSubmission;
  try {
    doc = JSON.parse(raw || JSON.stringify(EMPTY_QUIZ_SUBMISSION)) as QuizSubmission;
  } catch {
    doc = { ...EMPTY_QUIZ_SUBMISSION };
  }
  return fillInMissingQuizSubmissionFields(doc);
}

// -- seeded randomness (random.ts:1-29, verbatim sin-seed PRNG) ---------------

export function seededShuffle<T>(array: T[], seed: number): T[] {
  let m = array.length;
  let t: T;
  let i: number;
  while (m) {
    i = Math.floor(seededRandom(seed) * m--);
    t = array[m]!;
    array[m] = array[i]!;
    array[i] = t;
    ++seed;
  }
  return array;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function subsetRandomly<T>(array: T[], amount: number, seed: number): T[] {
  const copy = array.slice();
  seededShuffle(copy, seed);
  return copy.slice(0, amount);
}

// -- pool selection (quiz.ts:271-287) ------------------------------------------

/** The per-pool seed: SEED = submission id; ATTEMPT = id + attempt count;
 *  NONE (and the inert GROUP) = 0. */
export function poolSeed(
  randomness: string | undefined,
  seed: number,
  attemptCount: number,
): number {
  return randomness === 'SEED' ? seed : randomness === 'ATTEMPT' ? seed + attemptCount : 0;
}

/** hidePools as a pure function: which question ids are visible. */
export function selectVisibleQuestions(
  instructions: QuizInstructions,
  seed: number,
  attemptCount: number,
): Set<QuestionId> {
  const visible = new Set(Object.keys(instructions.questions ?? {}));
  const randomness = instructions.settings?.poolRandomness;
  for (const pool of instructions.pools ?? []) {
    const chosen = new Set(
      subsetRandomly(pool.questions, pool.amount, poolSeed(randomness, seed, attemptCount)),
    );
    for (const questionId of pool.questions) {
      if (!chosen.has(questionId)) visible.delete(questionId);
    }
  }
  return visible;
}

/** Pool back-references for the instructor "Pool: name" badge. */
export function poolByQuestion(instructions: QuizInstructions): Map<QuestionId, QuestionPool> {
  const map = new Map<QuestionId, QuestionPool>();
  for (const pool of instructions.pools ?? []) {
    for (const questionId of pool.questions) map.set(questionId, pool);
  }
  return map;
}

// -- blank extraction (questions.ts:4-5, 72-77) --------------------------------

export const SQUARE_BRACKETS = /(?<!\\)(\[.*?\]\]?)(?!\()/;

export function getBracketed(body: string): string[] {
  return body
    .split(SQUARE_BRACKETS)
    .filter((part) => !(part.startsWith('[[') && part.endsWith(']]')))
    .filter((part) => part.startsWith('[') && part.endsWith(']'))
    .map((part) => part.slice(1, -1));
}

// -- default answers (questions.ts:41-70, observables → plain values) ----------

export function defaultAnswer(question: QuizQuestion, previous: unknown): StudentAnswer {
  switch (question.type) {
    case 'multiple_answers_question':
      return Array.isArray(previous) && previous.length ? (previous as string[]) : [];
    case 'matching_question': {
      const statements = question.statements ?? [];
      return Array.isArray(previous) && previous.length
        ? statements.map((_, index) => (previous as Array<string | undefined>)[index])
        : statements.map(() => undefined);
    }
    case 'multiple_dropdowns_question': {
      const result: Record<string, string> = {};
      const source = (previous ?? {}) as Record<string, string>;
      for (const key of Object.keys((question.answers ?? {}) as Record<string, string[]>)) {
        result[key] = source[key] || '';
      }
      return result;
    }
    case 'fill_in_multiple_blanks_question': {
      const result: Record<string, string> = {};
      const source = (previous ?? {}) as Record<string, string>;
      for (const key of getBracketed(question.body)) {
        result[key] = source[key] || '';
      }
      return result;
    }
    default:
      return typeof previous === 'string' && previous ? previous : '';
  }
}

/** subscribeToStudent's answered check (quizzer_question_status.ts:56-59). */
export function isAnswered(question: QuizQuestion, answer: StudentAnswer | undefined): boolean {
  if (answer == null) return false;
  switch (question.type) {
    case 'matching_question':
      return (answer as Array<string | undefined>).some((value) => Boolean(value));
    case 'multiple_dropdowns_question':
    case 'fill_in_multiple_blanks_question':
      return Object.values(answer as Record<string, string>).some((value) => Boolean(value));
    case 'multiple_answers_question':
      return (answer as string[]).length > 0;
    default:
      return Boolean(answer);
  }
}

// -- serialization (quiz.ts:293-313 + LD-7) -------------------------------------

/**
 * Legacy serializes ONLY visible questions (dropping hidden-pool answers).
 * Studio preserves them under the additive `hiddenAnswers` key (LD-7):
 * process_quiz reads only `studentAnswers` (quizzes.py:60), and
 * regrade_if_quiz round-trips unknown top-level keys (submission.py:743-750).
 */
export function buildSubmissionDocument(options: {
  base: QuizSubmission;
  answers: Record<QuestionId, StudentAnswer>;
  feedback: Record<QuestionId, unknown>;
  visible: Set<QuestionId>;
  attempting: boolean;
  attemptCount: number;
  mulligans: number;
}): QuizSubmission {
  const { base, answers, feedback, visible, attempting, attemptCount, mulligans } = options;
  const studentAnswers: Record<QuestionId, StudentAnswer> = {};
  const hiddenAnswers: Record<QuestionId, StudentAnswer> = { ...(base.hiddenAnswers ?? {}) };
  const feedbackOut: Record<QuestionId, unknown> = {};
  for (const [questionId, answer] of Object.entries(answers)) {
    if (visible.has(questionId)) {
      studentAnswers[questionId] = answer;
      delete hiddenAnswers[questionId];
      feedbackOut[questionId] = feedback[questionId] ?? null;
    } else {
      hiddenAnswers[questionId] = answer;
    }
  }
  // Strip the prior hiddenAnswers before spreading - a fully-restored map
  // must disappear, not resurrect through the base document.
  const { hiddenAnswers: priorHidden, ...rest } = base;
  void priorHidden;
  return {
    ...rest, // summary + unknown fields round-trip (A3 open q. 8)
    studentAnswers,
    feedback: feedbackOut as QuizSubmission['feedback'],
    attempt: { attempting, count: attemptCount, mulligans },
    ...(Object.keys(hiddenAnswers).length ? { hiddenAnswers } : {}),
  };
}
