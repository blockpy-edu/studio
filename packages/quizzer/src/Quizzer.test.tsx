// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Quizzer, type QuizzerLoadResult, type QuizzerProps } from './Quizzer';
import type { QuizSubmission } from './types';

afterEach(cleanup);

const INSTRUCTIONS = {
  questions: {
    tf1: { type: 'true_false_question', body: 'Variables can change.', points: 1 },
    mcq1: {
      type: 'multiple_choice_question',
      body: 'Which prints?',
      points: 2,
      answers: ['print', 'echo'],
    },
    fimb1: {
      type: 'fill_in_multiple_blanks_question',
      body: 'The [noun] sat on the [place].',
      points: 1,
    },
    mystery1: { type: 'calculated_question', body: 'What is this?', points: 1 },
  },
  settings: { attemptLimit: 2, feedbackType: 'IMMEDIATE' },
  pools: [],
};

function loadResult(code = '', instructions: unknown = INSTRUCTIONS): QuizzerLoadResult {
  return {
    assignment: {
      id: 102,
      name: 'Quiz',
      url: 'quiz',
      instructions: JSON.stringify(instructions),
      settings: '{}',
    },
    submission: { id: 5002, code, correct: false, dateStarted: null, timeLimit: null },
  };
}

function renderQuizzer(props: Partial<QuizzerProps> = {}, result = loadResult()) {
  const loadAssignment = vi.fn(async () => result);
  const saveAnswer = vi.fn(async () => ({ success: true }));
  const view = render(
    <Quizzer
      assignmentId={102}
      loadAssignment={loadAssignment}
      saveAnswer={saveAnswer}
      {...props}
    />,
  );
  return { view, loadAssignment, saveAnswer };
}

// Two attempt bars (below + above the questions, quiz_ui.ts:211/248) mean
// every bar control appears twice.
const start = async () => {
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Start Quiz' }).length).toBe(2),
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Start Quiz' })[0]!);
};

describe('Quizzer (quizzer.ts port, §11.3)', () => {
  it('READY until started: content hidden for students, inputs appear on start', async () => {
    const { view, saveAnswer } = renderQuizzer();
    await waitFor(() => {
      expect(screen.getAllByText(/To begin the quiz/).length).toBe(2); // dual bars
    });
    expect(screen.getAllByText('2 attempts left.').length).toBe(2);
    // Question content hidden pre-attempt (questions_ui.html:25).
    expect(view.container.querySelector('.quizzer-question-body')).toBeNull();
    await start();
    expect(screen.getAllByText('Quiz In Progress!').length).toBe(2);
    expect(view.container.querySelectorAll('.quizzer-question-card').length).toBe(4);
    expect(screen.getByText('Variables can change.')).toBeDefined();
    // Start saved the attempt block (quizzer.ts:191).
    await waitFor(() => expect(saveAnswer).toHaveBeenCalled());
    const saved = JSON.parse(saveAnswer.mock.calls[0]![2] as string) as QuizSubmission;
    expect(saved.attempt).toEqual({ attempting: true, count: 1, mulligans: 0 });
  });

  it('unsupported types render the legacy fallback text', async () => {
    renderQuizzer();
    await start();
    expect(screen.getByText('I have no idea what this is!')).toBeDefined();
  });

  it('autosaves answers while attempting, with the quiz ids', async () => {
    const { saveAnswer } = renderQuizzer();
    await start();
    await waitFor(() => expect(saveAnswer).toHaveBeenCalled());
    saveAnswer.mockClear();
    fireEvent.click(screen.getByLabelText('True'));
    await waitFor(() => expect(saveAnswer).toHaveBeenCalled());
    const [assignmentId, submissionId, code] = saveAnswer.mock.calls.at(-1)! as [
      number,
      number,
      string,
    ];
    expect(assignmentId).toBe(102);
    expect(submissionId).toBe(5002);
    const doc = JSON.parse(code) as QuizSubmission;
    expect(doc.studentAnswers?.['tf1']).toBe('true');
  });

  it('fill-in-blanks hydrate inline inputs inside the body', async () => {
    const { view } = renderQuizzer();
    await start();
    await waitFor(() => {
      expect(view.container.querySelector('#question-fimb-3-noun')).not.toBeNull();
    });
    fireEvent.change(view.container.querySelector('#question-fimb-3-noun')!, {
      target: { value: 'cat' },
    });
    fireEvent.change(view.container.querySelector('#question-fimb-3-place')!, {
      target: { value: 'mat' },
    });
    await waitFor(() => {
      const inputs = view.container.querySelectorAll<HTMLInputElement>('input[id^="question-fimb"]');
      expect(Array.from(inputs).map((input) => input.value)).toEqual(['cat', 'mat']);
    });
  });

  it('submit applies server feedbacks, ends the attempt, and marks correct', async () => {
    const submitQuiz = vi.fn(async () => ({
      success: true,
      correct: true,
      feedbacks: {
        tf1: { message: 'Right!', correct: true, score: 1, status: 'graded' as const },
        mcq1: { message: 'Nope.', correct: false, score: 0, status: 'graded' as const },
      },
      submissionStatus: 'Completed',
    }));
    const markCorrect = vi.fn();
    const { view } = renderQuizzer({ submitQuiz, markCorrect });
    await start();
    fireEvent.click(screen.getByLabelText('True'));
    await waitFor(() => {
      const submit = screen.getAllByRole('button', { name: 'Submit answer' })[0]!;
      expect((submit as HTMLButtonElement).disabled).toBe(false); // saved → not dirty
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Submit answer' })[0]!);
    await waitFor(() => expect(submitQuiz).toHaveBeenCalledWith(102, 5002));
    await waitFor(() => {
      expect(screen.getAllByText(/You have completed the quiz/).length).toBe(2);
    });
    expect(markCorrect).toHaveBeenCalledWith(102);
    // IMMEDIATE feedback: message boxes + score fractions of points.
    expect(screen.getByText('Right!')).toBeDefined();
    expect(screen.getByText('Nope.')).toBeDefined();
    expect(view.container.querySelectorAll('.quizzer-feedback.bg-success').length).toBe(1);
    expect(view.container.querySelectorAll('.quizzer-feedback.bg-danger').length).toBe(1);
    // Inputs frozen once the attempt ends.
    expect((screen.getByLabelText('True') as HTMLInputElement).disabled).toBe(true);
  });

  it('feedbackType NONE hides feedback from students but not instructors', async () => {
    const submitQuiz = vi.fn(async () => ({
      success: true,
      correct: false,
      feedbacks: {
        tf1: { message: 'Hidden!', correct: false, score: 0, status: 'graded' as const },
      },
    }));
    const { view } = renderQuizzer(
      { submitQuiz },
      loadResult('', { ...INSTRUCTIONS, settings: { attemptLimit: 2, feedbackType: 'NONE' } }),
    );
    await start();
    fireEvent.click(screen.getAllByRole('button', { name: 'Submit answer' })[0]!);
    await waitFor(() => {
      expect(screen.getAllByText(/You have completed the quiz/).length).toBe(2);
    });
    expect(view.container.textContent).toContain('see any feedback');
    expect(screen.queryByText('Hidden!')).toBeNull();
    expect(view.container.querySelector('.quizzer-feedback')).toBeNull();
  });

  it('attempt limit gates Start (attemptLimit + mulligans - count)', async () => {
    const code = JSON.stringify({
      attempt: { attempting: false, count: 2, mulligans: 0 },
      studentAnswers: {},
      feedback: {},
    });
    renderQuizzer({}, loadResult(code));
    // Legacy quirk: 0 remaining renders "0 attempts left." — the
    // 'no attempts left!' string needs attempts to go NEGATIVE
    // (quiz.ts:163-168); canAttempt still gates the button at 0.
    await waitFor(() => {
      expect(screen.getAllByText('0 attempts left.').length).toBe(2);
    });
    expect(screen.queryByRole('button', { name: 'Try Quiz Again' })).toBeNull();
  });

  it('pool selection hides questions for students; LD-7 stashes their answers', async () => {
    const pooled = {
      questions: {
        a: { type: 'short_answer_question', body: 'A?', points: 1 },
        b: { type: 'short_answer_question', body: 'B?', points: 1 },
      },
      settings: { attemptLimit: -1, poolRandomness: 'SEED' },
      pools: [{ name: 'P', amount: 1, questions: ['a', 'b'] }],
    };
    const code = JSON.stringify({
      attempt: { attempting: true, count: 1, mulligans: 0 },
      studentAnswers: { a: 'answer-a', b: 'answer-b' },
      feedback: {},
    });
    const { view, saveAnswer } = renderQuizzer({}, loadResult(code, pooled));
    await waitFor(() => {
      expect(view.container.querySelectorAll('.quizzer-question-card').length).toBe(1);
    });
    // Trigger a save by editing the visible question.
    const input = view.container.querySelector<HTMLInputElement>('input[id^="question-sa"]')!;
    fireEvent.change(input, { target: { value: 'edited' } });
    await waitFor(() => expect(saveAnswer).toHaveBeenCalled());
    const doc = JSON.parse(saveAnswer.mock.calls.at(-1)![2] as string) as QuizSubmission;
    const visibleIds = Object.keys(doc.studentAnswers ?? {});
    const hiddenIds = Object.keys(doc.hiddenAnswers ?? {});
    expect(visibleIds).toHaveLength(1);
    expect(hiddenIds).toHaveLength(1);
    expect(doc.hiddenAnswers?.[hiddenIds[0]!]).toMatch(/^answer-/); // preserved, not dropped
  });

  it('instructors see everything: hidden pool questions, ids, View As Student', async () => {
    const pooled = {
      questions: {
        a: { type: 'short_answer_question', body: 'A?', points: 1 },
        b: { type: 'short_answer_question', body: 'B?', points: 1 },
      },
      settings: { attemptLimit: -1, poolRandomness: 'SEED' },
      pools: [{ name: 'P', amount: 1, questions: ['a', 'b'] }],
    };
    const { view } = renderQuizzer({ isInstructor: () => true }, loadResult('', pooled));
    await waitFor(() => {
      expect(screen.getByLabelText('View As Student')).toBeDefined();
    });
    // Not-as-student: both pool questions render, with pool badges + ids.
    expect(view.container.querySelectorAll('.quizzer-question-card').length).toBe(2);
    expect(screen.getAllByText(/Pool:/).length).toBe(2);
    expect(screen.getByText('(a)')).toBeDefined();
    fireEvent.click(screen.getByLabelText('View As Student'));
    await waitFor(() => {
      expect(view.container.querySelectorAll('.quizzer-question-card').length).toBe(1);
    });
  });
});
