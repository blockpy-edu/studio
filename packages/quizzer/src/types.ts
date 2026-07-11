/**
 * Frozen quiz JSON schema (appendix A3 §8, verbatim) — legacy-compatible
 * shapes for the three documents a quiz assignment stores:
 * instructions (assignment.instructions), checks (assignment.on_run,
 * blanked for students), and the submission (submission.code).
 * Unknown fields must round-trip untouched (README §11.3.7).
 */

export type QuestionId = string;
export type BlankId = string;

export type QuizQuestionType =
  | 'multiple_choice_question'
  | 'multiple_answers_question'
  | 'true_false_question'
  | 'text_only_question'
  | 'matching_question'
  | 'multiple_dropdowns_question'
  | 'short_answer_question'
  | 'fill_in_multiple_blanks_question'
  | 'essay_question'
  | 'numerical_question'
  // Declared but unsupported (no UI, grades as status:"error"); pass through:
  | 'calculated_question'
  | 'file_upload_question';

export type QuizFeedbackType = 'IMMEDIATE' | 'NONE' | 'SUMMARY';
export type QuizPoolRandomness = 'ATTEMPT' | 'SEED' | 'NONE' | 'GROUP'; // GROUP inert

export interface QuizInstructionsSettings {
  /** -1 = infinite (default). */
  attemptLimit?: number;
  /** Minutes; -1 = none (default); UNIMPLEMENTED in legacy too. */
  coolDown?: number;
  feedbackType?: QuizFeedbackType;
  /** -1 = all (default); UNIMPLEMENTED in legacy too. */
  questionsPerPage?: number;
  /** Default: SEED (empty template) / ATTEMPT (backfill) — quiz.ts:77 vs :112. */
  poolRandomness?: QuizPoolRandomness;
  /** Reading preamble: BlockPy id or assignment url slug. */
  readingId?: number | string | null;
}

export interface QuestionPool {
  name: string;
  /** How many of `questions` to show per attempt. */
  amount: number;
  questions: QuestionId[];
  /** Never read anywhere; preserved. */
  group?: string;
}

export interface QuizQuestion {
  type: QuizQuestionType;
  /** Markdown/HTML; may contain [blank_id] placeholders. */
  body: string;
  /** Weight within the quiz (grader defaults missing to 1). */
  points: number;
  /** Declared, unused. */
  title?: string;
  /** Attached to feedback when wrong (server-side only). */
  tags?: string[];
  /** Implied by map key; reinjected at load (quiz.ts:206-207). */
  id?: QuestionId;
  /** multiple_choice/answers: string[]; multiple_dropdowns: per-blank lists. */
  answers?: string[] | { [blank: BlankId]: string[] };
  /** matching_question left column. */
  statements?: string[];
  /** false ⇒ shuffle (LD-1: seeded in Studio, unseeded in legacy). */
  retainOrder?: boolean;
  /** Unsupported types round-trip whatever else they carry. */
  [key: string]: unknown;
}

export interface QuizInstructions {
  questions?: Record<QuestionId, QuizQuestion>;
  settings?: QuizInstructionsSettings;
  pools?: QuestionPool[];
  [key: string]: unknown;
}

// --- Student answers (submission.code → studentAnswers) ---
export type TrueFalseAnswer = '' | 'true' | 'false';
export type MultipleChoiceAnswer = string;
export type MultipleAnswersAnswer = string[];
export type MatchingAnswer = Array<string | undefined | null>;
export type KeyedTextAnswer = { [blank: BlankId]: string };
export type TextAnswer = string;

export type StudentAnswer =
  | TrueFalseAnswer
  | MultipleChoiceAnswer
  | MultipleAnswersAnswer
  | MatchingAnswer
  | KeyedTextAnswer
  | TextAnswer;

// --- Feedback records (questions.ts:110-115; quizzes.py:82-93) ---
export interface QuizQuestionFeedback {
  /** HTML. */
  message: string;
  /** null when status === "error". */
  correct: boolean | null;
  /** Fraction 0..1 of this question's points. */
  score: number;
  status: 'graded' | 'error';
  tags?: string[];
}

// --- Submission document (submission.code) ---
export interface QuizSubmissionAttempt {
  attempting?: boolean;
  /** Incremented client-side on Start Quiz. */
  count?: number;
  /** Instructor-granted extra attempts (give_quiz_mulligan). */
  mulligans?: number;
}

/** Server-written after grading; client must preserve (A3 open q. 8). */
export interface QuizSubmissionSummary {
  points_possible: number;
  score: number;
}

export interface QuizSubmission {
  studentAnswers?: Record<QuestionId, StudentAnswer>;
  attempt?: QuizSubmissionAttempt;
  feedback?: Record<QuestionId, QuizQuestionFeedback | null>;
  summary?: QuizSubmissionSummary;
  /**
   * LD-7 (Studio-additive): answers to pool-hidden questions, preserved
   * OUTSIDE studentAnswers so process_quiz never grades them (it counts
   * every answered question toward the total, quizzes.py:72-79).
   */
  hiddenAnswers?: Record<QuestionId, StudentAnswer>;
  [key: string]: unknown;
}

/** update_submission response fragment (post_grade.py:144-156). */
export interface QuizSubmitResponse {
  success: boolean;
  correct?: boolean;
  feedbacks?: Record<QuestionId, QuizQuestionFeedback>;
  submissionStatus?: string;
  message?: string;
}
