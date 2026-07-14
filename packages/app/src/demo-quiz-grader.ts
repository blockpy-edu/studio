/**
 * Wire-shaped quiz grading for the dev/demo stub — the quizzer's own
 * processQuiz (the engine the real server runs) over the last-saved
 * submission document. Kept in its own module because the two stub hosts
 * load it differently: the browser fetch stub imports it statically, and
 * the vite middleware loads it through `server.ssrLoadModule` (the config
 * bundle itself must not pull TS workspace imports — esbuild leaves bare
 * specifiers external and node can't execute .ts).
 */
import { processQuiz, type QuizChecksDocument } from '@blockpy/quizzer/grading';
import { parseQuizInstructions, parseQuizSubmission } from '@blockpy/quizzer/documents';
import type { DemoQuizRecord, DemoQuizWireResult } from './dev-stub';

export function gradeQuizWire(record: DemoQuizRecord, savedAnswer: string): DemoQuizWireResult {
  const instructions = parseQuizInstructions(record.instructions);
  const checks = JSON.parse(record.on_run ?? '{}') as QuizChecksDocument;
  const submission = parseQuizSubmission(savedAnswer);
  // Pool seed = the demo submission id (9000 + assignment id, demoLoadResponse)
  // so grading sees the same pooled-visible set the student did (LD-35).
  const result = processQuiz(instructions, checks, submission, { seed: 9000 + record.id });
  return {
    success: true,
    correct: result.correct,
    feedbacks: result.feedbacks,
    submission_status: result.correct ? 'Completed' : 'inProgress',
  };
}
