import { describe, expect, it } from 'vitest';
import { checkQuizQuestion, compareStringEquality, processQuiz } from './grading';
import { validateQuiz } from './validation';
import type { QuizInstructions, QuizQuestion } from './types';

const q = (type: string, extra: Partial<QuizQuestion> = {}): QuizQuestion =>
  ({ type, body: 'B', points: 1, ...extra }) as QuizQuestion;

describe('checkQuizQuestion (process_quiz port, quizzes.py:108-228)', () => {
  it('true/false: str(bool).lower() comparison; wrong feedback', () => {
    const check = { correct: true, wrong: 'Nope' };
    expect(checkQuizQuestion(q('true_false_question'), check, 'true')).toEqual({
      score: 1,
      correct: true,
      message: 'Correct',
    });
    expect(checkQuizQuestion(q('true_false_question'), check, 'false')).toEqual({
      score: 0,
      correct: false,
      message: 'Nope',
    });
  });

  it('multiple choice: string or list correct; per-answer feedback', () => {
    const question = q('multiple_choice_question', { answers: ['a', 'b'] });
    expect(checkQuizQuestion(question, { correct: 'a' }, 'a')?.correct).toBe(true);
    expect(checkQuizQuestion(question, { correct: ['a', 'b'] }, 'b')?.correct).toBe(true);
    const wrong = checkQuizQuestion(question, { correct: 'a', feedback: { b: 'Try a' } }, 'b');
    expect(wrong).toEqual({ score: 0, correct: false, message: 'Try a' });
  });

  it('multiple answers: partial credit per option, set equality for correct', () => {
    const question = q('multiple_answers_question', { answers: ['a', 'b', 'c'] });
    const check = { correct: ['a', 'b'], wrong_any: 'Missed some' };
    const result = checkQuizQuestion(question, check, ['a']);
    expect(result?.score).toBeCloseTo(2 / 3); // a matches, b mismatched, c matches
    expect(result?.correct).toBe(false);
    expect(result?.message).toBe('Missed some');
    expect(checkQuizQuestion(question, check, ['b', 'a'])?.correct).toBe(true);
    // Index-aligned wrong feedback fires only for mismatched options.
    const perOption = checkQuizQuestion(
      question,
      { correct: ['a'], wrong: [null, 'not b', 'not c'] },
      ['b'],
    );
    expect(perOption?.message).toBe('not b');
  });

  it('matching: list entries accept alternatives; partial credit', () => {
    const question = q('matching_question', {
      statements: ['s1', 's2'],
      answers: ['x', 'y', 'z'],
    });
    const check = { correct: ['x', ['y', 'z']] };
    expect(checkQuizQuestion(question, check, ['x', 'z'])?.correct).toBe(true);
    const half = checkQuizQuestion(question, check, ['x', 'x']);
    expect(half?.score).toBe(0.5);
    expect(half?.message).toBe('Incorrect');
  });

  it('matching: both feedback shapes (server list / bakery statement-dict)', () => {
    const question = q('matching_question', { statements: ['s1'], answers: ['x', 'y'] });
    const listForm = checkQuizQuestion(
      question,
      { correct: ['x'], feedback: [{ y: 'y is wrong' }] },
      ['y'],
    );
    expect(listForm?.message).toBe('y is wrong');
    const dictForm = checkQuizQuestion(question, { correct: ['x'], feedback: { s1: 'check s1' } }, [
      'y',
    ]);
    expect(dictForm?.message).toBe('check s1');
  });

  it('dropdowns: per-blank credit, blank feedback string-or-map, wrong_any', () => {
    const question = q('multiple_dropdowns_question', {
      body: 'Pick [one] and [two]',
      answers: { one: ['a', 'b'], two: ['c', 'd'] },
    });
    const check = {
      correct: { one: 'a', two: 'c' },
      feedback: { one: { b: 'not b!' } },
      wrong_any: 'Some wrong',
    };
    expect(checkQuizQuestion(question, check, { one: 'a', two: 'c' })?.correct).toBe(true);
    const withMap = checkQuizQuestion(question, check, { one: 'b', two: 'c' });
    expect(withMap?.score).toBe(0.5);
    expect(withMap?.message).toBe('not b!');
    const fallback = checkQuizQuestion(question, check, { one: 'a', two: 'd' });
    expect(fallback?.message).toBe('Some wrong');
  });

  it('short answer: trimmed exact (submission only), list membership, regex', () => {
    expect(compareStringEquality('  a  ', 'a')).toBe(true);
    expect(compareStringEquality('a', ['a', 'b'])).toBe(true);
    expect(compareStringEquality('', 'a')).toBe(false);
    const question = q('short_answer_question');
    expect(checkQuizQuestion(question, { correct: 'yes' }, ' yes ')?.correct).toBe(true);
    const regex = checkQuizQuestion(
      question,
      { correct_regex: ['^ye+s$'], feedback: { '^ye+s$': 'matched!' } },
      'yeees',
    );
    expect(regex?.correct).toBe(true);
    expect(regex?.message).toBe('Correct');
    // The server quirk: regex FEEDBACK is keyed by correct_regex entries.
    const wrongRegex = checkQuizQuestion(
      q('numerical_question'),
      { correct_regex: ['^42$'], wrong_any: 'Not 42' },
      '41',
    );
    expect(wrongRegex).toEqual({ score: 0, correct: false, message: 'Not 42' });
  });

  it('fill-in-blanks: per-blank exact/regex + documented rich feedback', () => {
    const question = q('fill_in_multiple_blanks_question', { body: '[a] and [b]' });
    const exact = checkQuizQuestion(
      question,
      { correct: { a: 'x', b: ['y', 'z'] }, wrong_any: 'Missed' },
      { a: 'x', b: 'z' },
    );
    expect(exact?.correct).toBe(true);
    const rich = checkQuizQuestion(
      question,
      { correct_regex: { a: ['^x$'], b: ['^y$'] }, feedback: { b: [{ '^q': 'q? really?' }] } },
      { a: 'x', b: 'qqq' },
    );
    expect(rich?.score).toBe(0.5);
    expect(rich?.message).toBe('q? really?');
  });

  it('essay/text-only always full credit; unknown types → null', () => {
    expect(checkQuizQuestion(q('essay_question'), {}, 'anything')?.correct).toBe(true);
    expect(checkQuizQuestion(q('calculated_question'), {}, 'x')).toBeNull();
  });
});

describe('processQuiz totals (quizzes.py:58-99)', () => {
  const INSTRUCTIONS: QuizInstructions = {
    questions: {
      tf: q('true_false_question'),
      mc: q('multiple_choice_question', { answers: ['a', 'b'], points: 3 }),
      skipped: q('true_false_question'),
    },
  };
  const CHECKS = { questions: { tf: { correct: true }, mc: { correct: 'a' } } };

  it('LD-35: unanswered presented questions grade as incorrect (points counted)', () => {
    // The server skips absent answers entirely (quizzes.py:72-76 "Hack"),
    // letting a blank question ride to correct=true. Studio grades it.
    const result = processQuiz(INSTRUCTIONS, CHECKS, {
      studentAnswers: { tf: 'true', mc: 'a' },
    });
    expect(result.pointsPossible).toBe(5); // 'skipped' now counted
    expect(result.score).toBeCloseTo(4 / 5);
    expect(result.correct).toBe(false); // the blank T/F blocks correct
    expect(result.feedbacks['skipped']).toMatchObject({ correct: false, score: 0 });
  });

  it('LD-35: pooled-out questions stay excluded; visible pooled ones grade', () => {
    const pooledInstructions: QuizInstructions = {
      questions: {
        p1: q('true_false_question'),
        p2: q('true_false_question'),
        fixed: q('true_false_question'),
      },
      pools: [{ name: 'pool', amount: 1, questions: ['p1', 'p2'] }],
    };
    const pooledChecks = {
      questions: { p1: { correct: true }, p2: { correct: true }, fixed: { correct: true } },
    };
    // No attempt context: pooled questions with absent answers are ambiguous
    // (which one was shown?) - both excluded; the fixed blank still grades.
    const noContext = processQuiz(pooledInstructions, pooledChecks, {
      studentAnswers: {},
    });
    expect(noContext.pointsPossible).toBe(1); // only 'fixed'
    expect(noContext.correct).toBe(false);
    expect(noContext.feedbacks['p1']).toBeUndefined();
    expect(noContext.feedbacks['p2']).toBeUndefined();
    // Explicit visibility: the shown pooled question grades when blank.
    const withVisible = processQuiz(
      pooledInstructions,
      pooledChecks,
      { studentAnswers: { fixed: 'true' } },
      { visible: new Set(['p1', 'fixed']) },
    );
    expect(withVisible.pointsPossible).toBe(2);
    expect(withVisible.feedbacks['p1']).toMatchObject({ correct: false });
    expect(withVisible.feedbacks['p2']).toBeUndefined();
    // A hiddenAnswers stash is positive evidence the question was hidden.
    const stashed = processQuiz(pooledInstructions, pooledChecks, {
      studentAnswers: { fixed: 'true' },
      hiddenAnswers: { p2: 'true' },
    });
    expect(stashed.feedbacks['p2']).toBeUndefined();
  });

  it('hardened T/F: coercion can never alias undefined answer to undefined check', () => {
    // Unauthored check + absent answer used to compute
    // String(undefined) === String(undefined) → a silent false PASS.
    expect(checkQuizQuestion(q('true_false_question'), {}, undefined)?.correct).toBe(false);
    expect(checkQuizQuestion(q('true_false_question'), {}, '')?.correct).toBe(false);
    expect(checkQuizQuestion(q('true_false_question'), { correct: true }, undefined)).toMatchObject(
      { correct: false, score: 0 },
    );
    // Authored string checks still compare case-insensitively.
    expect(checkQuizQuestion(q('true_false_question'), { correct: 'True' }, 'true')?.correct).toBe(
      true,
    );
  });

  it('nothing answered ⇒ correct=false; unknown type ⇒ error feedback', () => {
    const empty = processQuiz(INSTRUCTIONS, CHECKS, {});
    expect(empty.correct).toBe(false);
    expect(empty.pointsPossible).toBe(5); // all presented, all graded blank
    const weird = processQuiz(
      { questions: { c: q('calculated_question') } },
      { questions: {} },
      { studentAnswers: { c: 'x' } },
    );
    expect(weird.feedbacks['c']?.status).toBe('error');
    expect(weird.feedbacks['c']?.message).toContain('Unknown Type');
  });
});

describe('validateQuiz (bakery quiz_check port)', () => {
  it('flags missing required fields and bad answer ids', () => {
    const issues = validateQuiz(
      {
        questions: {
          bad: {
            type: 'multiple_dropdowns_question',
            body: 'Pick [bad id!]',
            points: 1,
            answers: { 'bad id!': ['x'] },
          } as unknown as QuizQuestion,
        },
      },
      { questions: { bad: { correct: { 'bad id!': 'x' } } } },
    );
    expect(issues.some((issue) => issue.message.includes('Invalid answer ID'))).toBe(true);
  });

  it('validates regexes and cross-references correct vs answers', () => {
    const issues = validateQuiz(
      {
        questions: {
          sa: { type: 'short_answer_question', body: 'B', points: 1 } as QuizQuestion,
          mc: {
            type: 'multiple_choice_question',
            body: 'B',
            points: 1,
            answers: ['a'],
          } as QuizQuestion,
        },
      },
      {
        questions: {
          sa: { correct_regex: ['[unclosed'] },
          mc: { correct: 'zzz' },
        },
      },
    );
    expect(issues.some((issue) => issue.message.includes('Invalid regex'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('not in the list of answers'))).toBe(true);
  });

  it('accepts a clean quiz and warns on orphaned checks + starving pools', () => {
    const issues = validateQuiz(
      {
        questions: {
          tf: { type: 'true_false_question', body: 'B', points: 1 } as QuizQuestion,
        },
        pools: [{ name: 'P', amount: 2, questions: ['tf'] }],
      },
      { questions: { tf: { correct: true }, ghost: { correct: false } } },
    );
    expect(issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
    expect(issues.some((issue) => issue.message.includes('no matching question'))).toBe(true);
    expect(issues.some((issue) => issue.message.includes('only has 1'))).toBe(true);
  });
});
