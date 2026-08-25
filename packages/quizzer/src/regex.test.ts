import { describe, expect, it } from 'vitest';
import { compilePythonRegex, pythonRegexError, translatePythonRegex } from './regex';
import { checkQuizQuestion } from './grading';
import { validateQuiz } from './validation';
import type { QuizInstructions } from './types';

describe('Python re → RegExp translation', () => {
  it('translates named groups and backreferences', () => {
    expect(translatePythonRegex('(?P<word>\\w+) (?P=word)')).toEqual({
      source: '(?<word>\\w+) \\k<word>',
      flags: '',
    });
    expect(compilePythonRegex('(?P<n>\\d+)').exec('x42')?.groups?.['n']).toBe('42');
  });

  it('lifts leading inline flags into RegExp flags', () => {
    expect(translatePythonRegex('(?i)hello')).toEqual({ source: 'hello', flags: 'i' });
    expect(translatePythonRegex('(?ims)^a.b$')).toEqual({ source: '^a.b$', flags: 'ims' });
    expect(compilePythonRegex('(?i)hello').test('HeLLo')).toBe(true);
  });

  it('approximates \\A and \\Z as anchors, leaving escaped backslashes alone', () => {
    expect(translatePythonRegex('\\Afoo\\Z').source).toBe('^foo$');
    expect(translatePythonRegex('\\\\Z').source).toBe('\\\\Z');
    expect(compilePythonRegex('\\Aab\\Z').test('ab')).toBe(true);
    expect(compilePythonRegex('\\Aab\\Z').test('abc')).toBe(false);
  });

  it('pythonRegexError is null for translatable patterns and explanatory otherwise', () => {
    expect(pythonRegexError('(?P<x>a)+')).toBeNull();
    const failure = pythonRegexError('(?<=a)(?x)b'); // (?x) mid-pattern: JS rejects
    expect(failure).toContain('Python');
    expect(failure).toContain('cannot be checked locally');
  });

  it('local grading accepts Python-only spellings the server would', () => {
    const question = { type: 'short_answer_question', body: 'Say hi', points: 1 } as const;
    const check = {
      correct_regex: ['(?i)h(?P<vowel>[ie])'],
      feedback: { '(?i)h(?P<vowel>[ie])': 'ok' },
    };
    expect(checkQuizQuestion(question, check, 'HI there')?.correct).toBe(true);
    expect(checkQuizQuestion(question, check, 'bye')?.correct).toBe(false);
  });

  it('validation reports uncompilable patterns as possibly-valid Python rather than invalid', () => {
    const instructions: QuizInstructions = {
      questions: { sa: { type: 'short_answer_question', body: 'x', points: 1 } },
    };
    const issues = validateQuiz(instructions, {
      questions: { sa: { correct_regex: ['(?P<ok>a)', '(?x) a b'] } },
    });
    const messages = issues.map((issue) => issue.message);
    expect(messages.some((message) => message.includes('(?P<ok>a)'))).toBe(false);
    const reported = messages.find((message) => message.includes('(?x) a b'));
    expect(reported).toBeDefined();
    expect(reported).toMatch(/Could not compile regex/);
    expect(reported).toMatch(/may still be valid Python/);
  });
});
