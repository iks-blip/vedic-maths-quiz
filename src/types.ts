export type Difficulty = "easy" | "medium" | "hard";

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctAnswer: string;
  difficulty: Difficulty;
}

export interface PublicQuestion {
  id: string;
  text: string;
  options: string[];
  difficulty: Difficulty;
}

export interface AttemptQuestion {
  questionId: string;
  selectedAnswer: string;
  isCorrect: boolean;
  answeredAt: string;
  answeredInSeconds: number;
  pointsAwarded: number;
}

export interface AttemptSummary {
  attemptId: string;
  name: string;
  email: string;
  score: number;
  submittedAt: string;
}

export type AttemptStatus = "in_progress" | "submitted" | "void";

export interface Attempt {
  id: string;
  name: string;
  email: string;
  startedAt: number;
  quizDeadlineAt: number;
  graceConsumed: boolean;
  graceQuestionIndex?: number;
  status: AttemptStatus;
  currentIndex: number;
  currentQuestionShownAt: number;
  tabSwitchCount: number;
  lastSeenAt: number;
  score: number;
  questions: Question[];
  answers: AttemptQuestion[];
  submittedAt?: number;
  voidReason?: string;
  submissionAuditLogged?: boolean;
  isDisqualified?: boolean;
  disqualifiedAt?: number;
  disqualifiedBy?: string;
}

export type AuditEventType =
  | "attempt_started"
  | "attempt_submitted"
  | "attempt_voided"
  | "tab_switch_warning"
  | "attempt_disqualified"
  | "event_state_changed";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  attemptId: string;
  email: string;
  name: string;
  at: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface StartAttemptResponse {
  attemptId: string;
  question: PublicQuestion;
  totalQuestions: number;
  quizDurationSeconds: number;
  deadlineAt: string;
}

export interface AnswerResponse {
  status: AttemptStatus;
  score: number;
  question?: PublicQuestion;
  progress: {
    answered: number;
    total: number;
  };
  submittedAt?: string;
  reason?: string;
}
