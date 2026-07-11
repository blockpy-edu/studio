import { describe, expect, it } from 'vitest';
import {
  buildSubmissionDocument,
  defaultAnswer,
  fillInMissingQuizInstructionFields,
  getBracketed,
  isAnswered,
  parseQuizSubmission,
  poolSeed,
  selectVisibleQuestions,
  subsetRandomly,
} from './documents';
import { attemptsLeftText } from './Quizzer';
import type { QuizInstructions, QuizQuestion } from './types';

describe('document fill-ins (quiz.ts:83-114)', () => {
  it('backfills defaults without touching unknown fields', () => {
    const instructions = fillInMissingQuizInstructionFields({
      questions: { q1: { type: 'true_false_question', body: 'x', points: 1 } },
      mystery: 'kept',
    } as QuizInstructions);
    expect(instructions.settings?.attemptLimit).toBe(-1);
    expect(instructions.settings?.feedbackType).toBe('IMMEDIATE');
    // The backfill default is ATTEMPT (quiz.ts:112), not the template's SEED.
    expect(instructions.settings?.poolRandomness).toBe('ATTEMPT');
    expect(instructions['mystery']).toBe('kept');
  });

  it('parses empty/corrupt submissions to the empty document', () => {
    const doc = parseQuizSubmission('');
    expect(doc.attempt).toEqual({ attempting: false, count: 0, mulligans: 0 });
    expect(parseQuizSubmission('not json').studentAnswers).toEqual({});
  });
});

describe('seeded pool selection (quiz.ts:271-287, random.ts)', () => {
  const INSTRUCTIONS: QuizInstructions = {
    questions: {
      fixed: { type: 'true_false_question', body: 'x', points: 1 },
      a: { type: 'short_answer_question', body: 'a', points: 1 },
      b: { type: 'short_answer_question', body: 'b', points: 1 },
      c: { type: 'short_answer_question', body: 'c', points: 1 },
    },
    settings: { poolRandomness: 'SEED' },
    pools: [{ name: 'P', amount: 2, questions: ['a', 'b', 'c'] }],
  };

  it('subsetRandomly reproduces for the same seed and differs across seeds', () => {
    const first = subsetRandomly(['a', 'b', 'c', 'd', 'e'], 3, 42);
    expect(subsetRandomly(['a', 'b', 'c', 'd', 'e'], 3, 42)).toEqual(first);
    const seeds = [1, 2, 3, 4, 5].map((seed) =>
      subsetRandomly(['a', 'b', 'c', 'd', 'e'], 3, seed).join(''),
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('pool membership: non-pooled questions always visible; amount honored', () => {
    const visible = selectVisibleQuestions(INSTRUCTIONS, 5002, 0);
    expect(visible.has('fixed')).toBe(true);
    expect(['a', 'b', 'c'].filter((id) => visible.has(id))).toHaveLength(2);
    // Same seed → same selection (reload reproducibility, A3 §2.3).
    expect(selectVisibleQuestions(INSTRUCTIONS, 5002, 0)).toEqual(visible);
  });

  it('ATTEMPT randomness folds the attempt count into the seed', () => {
    expect(poolSeed('SEED', 10, 3)).toBe(10);
    expect(poolSeed('ATTEMPT', 10, 3)).toBe(13);
    expect(poolSeed('NONE', 10, 3)).toBe(0);
    expect(poolSeed('GROUP', 10, 3)).toBe(0); // inert (quiz.ts:289-291)
  });
});

describe('answers (questions.ts:41-108)', () => {
  const FIMB: QuizQuestion = {
    type: 'fill_in_multiple_blanks_question',
    body: 'A [first] and \\[escaped] and [[literal]] and [second].',
    points: 1,
  };

  it('getBracketed extracts blank ids, skipping escapes and [[literals]]', () => {
    expect(getBracketed(FIMB.body)).toEqual(['first', 'second']);
  });

  it('defaultAnswer shapes per type and restores previous values', () => {
    expect(defaultAnswer({ type: 'true_false_question', body: '', points: 1 }, undefined)).toBe(
      '',
    );
    expect(
      defaultAnswer({ type: 'multiple_answers_question', body: '', points: 1 }, ['x']),
    ).toEqual(['x']);
    expect(
      defaultAnswer(
        { type: 'matching_question', body: '', points: 1, statements: ['s1', 's2'] },
        undefined,
      ),
    ).toEqual([undefined, undefined]);
    expect(defaultAnswer(FIMB, { first: 'kept' })).toEqual({ first: 'kept', second: '' });
    expect(
      defaultAnswer(
        {
          type: 'multiple_dropdowns_question',
          body: '[x]',
          points: 1,
          answers: { x: ['1', '2'] },
        },
        undefined,
      ),
    ).toEqual({ x: '' });
  });

  it('isAnswered per shape', () => {
    const tf: QuizQuestion = { type: 'true_false_question', body: '', points: 1 };
    expect(isAnswered(tf, '')).toBe(false);
    expect(isAnswered(tf, 'true')).toBe(true);
    const matching: QuizQuestion = {
      type: 'matching_question',
      body: '',
      points: 1,
      statements: ['a'],
    };
    expect(isAnswered(matching, [undefined])).toBe(false);
    expect(isAnswered(matching, ['x'])).toBe(true);
    expect(isAnswered(FIMB, { first: '', second: '' })).toBe(false);
    expect(isAnswered(FIMB, { first: 'x', second: '' })).toBe(true);
  });
});

describe('submission serialization (quiz.ts:293-313 + LD-7)', () => {
  it('visible answers go to studentAnswers; hidden ones to hiddenAnswers', () => {
    const doc = buildSubmissionDocument({
      base: { summary: { points_possible: 3, score: 0.5 }, mystery: 'kept' },
      answers: { shown: 'yes', hidden: 'preserved' },
      feedback: { shown: { message: 'ok', correct: true, score: 1, status: 'graded' } },
      visible: new Set(['shown']),
      attempting: true,
      attemptCount: 2,
      mulligans: 1,
    });
    expect(doc.studentAnswers).toEqual({ shown: 'yes' });
    expect(doc.hiddenAnswers).toEqual({ hidden: 'preserved' });
    expect(doc.attempt).toEqual({ attempting: true, count: 2, mulligans: 1 });
    // Server-owned + unknown fields round-trip (A3 open q. 8).
    expect(doc.summary).toEqual({ points_possible: 3, score: 0.5 });
    expect(doc['mystery']).toBe('kept');
    // Feedback serializes for visible questions only (legacy shape).
    expect(Object.keys(doc.feedback ?? {})).toEqual(['shown']);
  });

  it('a question returning to visibility moves its answer back', () => {
    const doc = buildSubmissionDocument({
      base: { hiddenAnswers: { q1: 'stashed' } },
      answers: { q1: 'stashed' },
      feedback: {},
      visible: new Set(['q1']),
      attempting: true,
      attemptCount: 1,
      mulligans: 0,
    });
    expect(doc.studentAnswers).toEqual({ q1: 'stashed' });
    expect(doc.hiddenAnswers).toBeUndefined();
  });
});

describe('attemptsLeftText (quiz.ts:163-168)', () => {
  it('renders the verbatim strings', () => {
    expect(attemptsLeftText(-1, 0, 5)).toBe('infinite attempts left.');
    expect(attemptsLeftText(3, 0, 2)).toBe('only one attempt left.');
    expect(attemptsLeftText(3, 1, 2)).toBe('2 attempts left.');
    expect(attemptsLeftText(2, 0, 3)).toBe('no attempts left!');
  });
});
