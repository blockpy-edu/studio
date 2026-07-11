/**
 * @blockpy/quizzer — quiz assignments: the A3 frozen schema, seeded pools,
 * attempt lifecycle, and server-graded submission flow (spec §11.3).
 */
export {
  Quizzer,
  attemptsLeftText,
  type QuizMode,
  type QuizzerAssignment,
  type QuizzerLoadResult,
  type QuizzerProps,
  type QuizzerSubmission,
} from './Quizzer';
export { QuestionView, StatusSquare, questionStatusCode } from './QuestionView';
export { QuizEditor, type QuizEditorMode, type QuizEditorProps } from './editor/QuizEditor';
export { QuestionEditor } from './editor/QuestionEditor';
export {
  checkQuizQuestion,
  compareStringEquality,
  processQuiz,
  type LocalQuizResult,
  type QuizChecksDocument,
} from './grading';
export {
  FEEDBACK_FIELDS,
  QUESTION_TYPES,
  QuizIssueTracker,
  TAG_FIELDS,
  validateQuiz,
  type QuizIssue,
} from './validation';
export {
  EMPTY_QUIZ_SUBMISSION,
  SQUARE_BRACKETS,
  buildSubmissionDocument,
  defaultAnswer,
  fillInMissingQuizInstructionFields,
  fillInMissingQuizSubmissionFields,
  getBracketed,
  isAnswered,
  parseQuizInstructions,
  parseQuizSubmission,
  poolByQuestion,
  poolSeed,
  seededShuffle,
  selectVisibleQuestions,
  subsetRandomly,
} from './documents';
export type * from './types';
