// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuestionEditor, type QuestionEditorProps } from './QuestionEditor';
import { QuizEditor } from './QuizEditor';
import type { QuizQuestion } from '../types';

afterEach(cleanup);

const MCQ: QuizQuestion = {
  type: 'multiple_choice_question',
  body: 'Pick one',
  points: 1,
  answers: ['alpha', 'beta'],
};

function renderQuestion(overrides: Partial<QuestionEditorProps> = {}) {
  const props: QuestionEditorProps = {
    questionId: 'q1',
    question: MCQ,
    check: { correct: 'alpha' },
    issues: [],
    index: 0,
    count: 2,
    renderMarkdown: (text) => text,
    onChangeQuestion: vi.fn(),
    onChangeCheck: vi.fn(),
    onRename: vi.fn(() => true),
    onDelete: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
  const view = render(<QuestionEditor {...props} />);
  return { view, props };
}

const idInput = (view: ReturnType<typeof render>) =>
  view.container.querySelector<HTMLInputElement>('.quizzer-editor-id')!;

describe('QuestionEditor id rename', () => {
  it('commits a distinct new id on blur', () => {
    const { view, props } = renderQuestion();
    fireEvent.change(idInput(view), { target: { value: 'q_renamed' } });
    fireEvent.blur(idInput(view));
    expect(props.onRename).toHaveBeenCalledWith('q_renamed');
    expect(view.container.querySelector('.quizzer-editor-id-error')).toBeNull();
  });

  it('rejects a colliding id: keeps the old id, resets the draft, shows a message', () => {
    const { view, props } = renderQuestion({ onRename: vi.fn(() => false) });
    fireEvent.change(idInput(view), { target: { value: 'q2' } });
    fireEvent.blur(idInput(view));
    expect(props.onRename).toHaveBeenCalledWith('q2');
    expect(idInput(view).value).toBe('q1');
    expect(screen.getByText(/already exists/)).toBeDefined();
  });

  it('rejects an empty id without calling onRename', () => {
    const { view, props } = renderQuestion();
    fireEvent.change(idInput(view), { target: { value: '   ' } });
    fireEvent.blur(idInput(view));
    expect(props.onRename).not.toHaveBeenCalled();
    expect(idInput(view).value).toBe('q1');
    expect(screen.getByText(/cannot be empty/)).toBeDefined();
  });

  it('QuizEditor refuses to clobber an existing question on rename', () => {
    const instructions = JSON.stringify({
      questions: {
        a: { ...MCQ, body: 'A body' },
        b: { ...MCQ, body: 'B body' },
      },
    });
    const checks = JSON.stringify({
      questions: { a: { correct: 'alpha' }, b: { correct: 'beta' } },
    });
    const onSave = vi.fn(async () => ({ success: true }));
    const view = render(<QuizEditor instructions={instructions} checks={checks} onSave={onSave} />);
    const ids = view.container.querySelectorAll<HTMLInputElement>('.quizzer-editor-id');
    fireEvent.change(ids[0]!, { target: { value: 'b' } });
    fireEvent.blur(ids[0]!);
    expect(ids[0]!.value).toBe('a');
    expect(screen.getByText(/already exists/)).toBeDefined();
    // Both questions survive, in order, with their own checks.
    const cards = view.container.querySelectorAll('.quizzer-editor-question');
    expect([...cards].map((card) => card.getAttribute('data-question-id'))).toEqual(['a', 'b']);
    expect(screen.getByDisplayValue('A body')).toBeDefined();
    expect(screen.getByDisplayValue('B body')).toBeDefined();
    // Save stays disabled: nothing changed.
    expect((screen.getByRole('button', { name: 'Save Quiz' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('QuestionEditor one-per-line textareas', () => {
  it('keeps a trailing newline in the draft while committing the non-empty lines', () => {
    const onChangeQuestion = vi.fn();
    const { view } = renderQuestion({ onChangeQuestion });
    const textarea = view.container.querySelector<HTMLTextAreaElement>('.quizzer-editor-lines')!;
    expect(textarea.value).toBe('alpha\nbeta');
    fireEvent.change(textarea, { target: { value: 'alpha\nbeta\n' } });
    expect(textarea.value).toBe('alpha\nbeta\n');
    expect(onChangeQuestion).toHaveBeenLastCalledWith({ ...MCQ, answers: ['alpha', 'beta'] });
    fireEvent.change(textarea, { target: { value: 'alpha\nbeta\ngamma' } });
    expect(onChangeQuestion).toHaveBeenLastCalledWith({
      ...MCQ,
      answers: ['alpha', 'beta', 'gamma'],
    });
  });

  it('typing Enter through the QuizEditor round trip is not discarded', () => {
    const instructions = JSON.stringify({ questions: { q1: MCQ } });
    const checks = JSON.stringify({ questions: { q1: { correct: 'alpha' } } });
    const view = render(
      <QuizEditor
        instructions={instructions}
        checks={checks}
        onSave={vi.fn(async () => ({ success: true }))}
      />,
    );
    const textarea = view.container.querySelector<HTMLTextAreaElement>('.quizzer-editor-lines')!;
    fireEvent.change(textarea, { target: { value: 'alpha\nbeta\n' } });
    expect(textarea.value).toBe('alpha\nbeta\n');
    fireEvent.change(textarea, { target: { value: 'alpha\nbeta\ng' } });
    expect(textarea.value).toBe('alpha\nbeta\ng');
    expect(screen.getByText('g')).toBeDefined(); // the new option's radio label
  });

  it('resyncs the draft when the array changes from outside', () => {
    const { view } = renderQuestion();
    const textarea = view.container.querySelector<HTMLTextAreaElement>('.quizzer-editor-lines')!;
    view.rerender(
      <QuestionEditor
        {...{
          questionId: 'q1',
          question: { ...MCQ, answers: ['x', 'y', 'z'] },
          check: { correct: 'x' },
          issues: [],
          index: 0,
          count: 1,
          renderMarkdown: (text: string) => text,
          onChangeQuestion: vi.fn(),
          onChangeCheck: vi.fn(),
          onRename: vi.fn(() => true),
          onDelete: vi.fn(),
          onMove: vi.fn(),
        }}
      />,
    );
    expect(textarea.value).toBe('x\ny\nz');
  });
});

describe('QuestionEditor JsonField', () => {
  const jsonFields = (view: ReturnType<typeof render>) => [
    ...view.container.querySelectorAll<HTMLTextAreaElement>('.quizzer-editor-json-field textarea'),
  ];

  it('resyncs its text when the incoming value changes', () => {
    const { view } = renderQuestion();
    const feedbackField = jsonFields(view)[0]!; // per-answer feedback map
    expect(JSON.parse(feedbackField.value)).toEqual({});
    view.rerender(
      <QuestionEditor
        questionId="q1"
        question={MCQ}
        check={{ correct: 'alpha', feedback: { beta: 'nope' } }}
        issues={[]}
        index={0}
        count={1}
        renderMarkdown={(text) => text}
        onChangeQuestion={vi.fn()}
        onChangeCheck={vi.fn()}
        onRename={vi.fn(() => true)}
        onDelete={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    expect(JSON.parse(feedbackField.value)).toEqual({ beta: 'nope' });
  });

  it('does not clobber text the user is editing (focused, or with a parse error)', () => {
    const onChangeCheck = vi.fn();
    const { view } = renderQuestion({ onChangeCheck });
    const feedbackField = jsonFields(view)[0]!;
    fireEvent.focus(feedbackField);
    fireEvent.change(feedbackField, { target: { value: '{"beta": ' } });
    expect(screen.getAllByText(/SyntaxError/).length).toBeGreaterThan(0);
    view.rerender(
      <QuestionEditor
        questionId="q1"
        question={MCQ}
        check={{ correct: 'alpha', feedback: { beta: 'external' } }}
        issues={[]}
        index={0}
        count={1}
        renderMarkdown={(text) => text}
        onChangeQuestion={vi.fn()}
        onChangeCheck={onChangeCheck}
        onRename={vi.fn(() => true)}
        onDelete={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    expect(feedbackField.value).toBe('{"beta": ');
  });

  it('Advanced JSON and the structured widgets stay in sync inside the QuizEditor', () => {
    const instructions = JSON.stringify({ questions: { q1: MCQ } });
    const checks = JSON.stringify({ questions: { q1: { correct: 'alpha' } } });
    const view = render(
      <QuizEditor
        instructions={instructions}
        checks={checks}
        onSave={vi.fn(async () => ({ success: true }))}
      />,
    );
    const body = screen.getByDisplayValue('Pick one');
    fireEvent.change(body, { target: { value: 'Pick two' } });
    const questionJson = jsonFields(view).find((field) =>
      field.value.includes('"type": "multiple_choice_question"'),
    )!;
    expect(JSON.parse(questionJson.value).body).toBe('Pick two');
  });
});
