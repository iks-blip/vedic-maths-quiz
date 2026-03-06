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
