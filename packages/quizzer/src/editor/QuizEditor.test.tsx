// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuizEditor } from './QuizEditor';

afterEach(cleanup);

const INSTRUCTIONS = JSON.stringify({
  questions: {
    tf1: { type: 'true_false_question', body: 'Variables can change.', points: 1 },
  },
  settings: { attemptLimit: 2, feedbackType: 'IMMEDIATE' },
  pools: [],
});
const CHECKS = JSON.stringify({ questions: { tf1: { correct: true } } });

function renderEditor(instructions = INSTRUCTIONS, checks = CHECKS) {
  const onSave = vi.fn(async (_i: string, _c: string) => ({ success: true }));
  const view = render(<QuizEditor instructions={instructions} checks={checks} onSave={onSave} />);
  return { view, onSave };
}

describe('QuizEditor (visual authoring, 2026-07-11 requirement)', () => {
  it('renders the visual editor with settings, question, and no issues', () => {
    const { view } = renderEditor();
    expect(view.container.querySelector('.quizzer-editor-question')).not.toBeNull();
    expect(screen.getByText('No issues found')).toBeDefined();
    expect(screen.getByDisplayValue('Variables can change.') as HTMLTextAreaElement).toBeDefined();
  });

  it('edits flow into the documents and Save persists both', async () => {
    const { onSave } = renderEditor();
    fireEvent.change(screen.getByDisplayValue('Variables can change.'), {
      target: { value: 'Constants never change.' },
    });
    const save = screen.getByRole('button', { name: 'Save Quiz' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [savedInstructions, savedChecks] = onSave.mock.calls[0]!;
    expect(JSON.parse(savedInstructions).questions.tf1.body).toBe('Constants never change.');
    expect(JSON.parse(savedChecks).questions.tf1.correct).toBe(true);
  });

  it('live validation flags issues as you edit', async () => {
    renderEditor(
      JSON.stringify({
        questions: {
          mc1: { type: 'multiple_choice_question', body: 'B', points: 1, answers: ['a'] },
        },
      }),
      JSON.stringify({ questions: { mc1: { correct: 'ghost' } } }),
    );
    expect(screen.getByText(/1 error/)).toBeDefined();
    expect(screen.getByText(/not in the list of answers/)).toBeDefined();
  });

  it('adds and deletes questions, keeping checks in sync', async () => {
    const { view, onSave } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Add Question' }));
    expect(view.container.querySelectorAll('.quizzer-editor-question')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    expect(view.container.querySelectorAll('.quizzer-editor-question')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save Quiz' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [savedInstructions, savedChecks] = onSave.mock.calls[0]!;
    expect(Object.keys(JSON.parse(savedInstructions).questions)).toEqual(['question_2']);
    expect(JSON.parse(savedChecks).questions['tf1']).toBeUndefined();
  });

  it('Raw mode edits the document strings verbatim; JSON mode reports parse errors', () => {
    const { view } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Raw Editor' }));
    const instructionsBox = view.container.querySelector<HTMLTextAreaElement>(
      '.quizzer-editor-instructions-text',
    )!;
    expect(instructionsBox.value).toBe(INSTRUCTIONS);
    fireEvent.click(screen.getByRole('button', { name: 'JSON Editor' }));
    fireEvent.change(view.container.querySelector('.quizzer-editor-checks-text')!, {
      target: { value: '{not json' },
    });
    expect(screen.getByText(/Checks JSON:/)).toBeDefined();
  });

  it('Try It grades the draft locally through the student surface', async () => {
    const { view } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Try It' }));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Start Quiz' }).length).toBe(2),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Start Quiz' })[0]!);
    await waitFor(() => expect(screen.getByLabelText('True')).toBeDefined());
    fireEvent.click(screen.getByLabelText('True'));
    await waitFor(() => {
      const submit = screen.getAllByRole('button', { name: 'Submit answer' })[0]!;
      expect((submit as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Submit answer' })[0]!);
    await waitFor(() => {
      expect(view.container.querySelector('.quizzer-tryit-summary')?.textContent).toContain(
        'Local grade: score 100.0%',
      );
    });
    // The graded feedback rendered in the embedded student surface.
    expect(view.container.querySelector('.quizzer-feedback.bg-success')).not.toBeNull();
  });
});
