import { v4 as uuidv4 } from "uuid";
import {
  DISCONNECT_GRACE_SECONDS,
  MIN_POINTS_AFTER_20_SECONDS,
  QUESTIONS_PER_ATTEMPT,
  QUIZ_DURATION_SECONDS,
  SCORE_THRESHOLDS,
  TARGET_DISTRIBUTION
} from "./config.js";
import type { AttemptStore } from "./store.js";
import type { AuditStore } from "./audit-store.js";
import type { EventControlState, EventControlStatus, EventControlStore } from "./event-control-store.js";
import {
  AuditEvent,
  AnswerResponse,
  Attempt,
  AttemptSummary,
  PublicQuestion,
  Question,
  StartAttemptResponse
} from "./types.js";
import { eventWindowMessage } from "./event-window.js";

export class QuizRuleError extends Error {
  constructor(message: string, public readonly statusCode: number = 400) {
    super(message);
  }
}

interface QuizEngineOptions {
  now?: () => number;
  random?: () => number;
  quizDurationSeconds?: number;
  disconnectGraceSeconds?: number;
  eventStartAtMs?: number;
  eventEndAtMs?: number;
}

export class QuizEngine {
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly quizDurationSeconds: number;
  private readonly disconnectGraceSeconds: number;
  private readonly eventStartAtMs: number;
  private readonly eventEndAtMs: number;

  constructor(
    private readonly questionBank: Question[],
    private readonly store: AttemptStore,
    private readonly auditStore: AuditStore,
    private readonly eventControlStore: EventControlStore,
    options: QuizEngineOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.quizDurationSeconds = options.quizDurationSeconds ?? QUIZ_DURATION_SECONDS;
    this.disconnectGraceSeconds = options.disconnectGraceSeconds ?? DISCONNECT_GRACE_SECONDS;
    this.eventStartAtMs = options.eventStartAtMs ?? Number.NEGATIVE_INFINITY;
    this.eventEndAtMs = options.eventEndAtMs ?? Number.POSITIVE_INFINITY;

    if (questionBank.length < QUESTIONS_PER_ATTEMPT) {
      throw new Error("Question bank size is below minimum required questions");
    }
  }

  async startAttempt(name: string, email: string): Promise<StartAttemptResponse> {
    this.assertWithinEventWindowForStart(this.now());
    await this.assertCanStartByAdminControl();

    const normalizedEmail = email.trim().toLowerCase();
    if (!name.trim()) {
      throw new QuizRuleError("Name is required");
    }
    if (!normalizedEmail) {
      throw new QuizRuleError("Email is required");
    }

    const selectedQuestions = this.selectQuestionsForAttempt();
    const now = this.now();
    const attemptId = uuidv4();

    const attempt: Attempt = {
      id: attemptId,
      name: name.trim(),
      email: normalizedEmail,
      startedAt: now,
      quizDeadlineAt: now + this.quizDurationSeconds * 1000,
      graceConsumed: false,
      status: "in_progress",
      currentIndex: 0,
      currentQuestionShownAt: now,
      tabSwitchCount: 0,
      lastSeenAt: now,
      score: 0,
      questions: selectedQuestions,
      answers: []
    };

    await this.store.saveAttempt(attempt);
    await this.logAudit({
      type: "attempt_started",
      attempt
    });

    return {
      attemptId,
      question: this.toPublicQuestion(selectedQuestions[0]),
      totalQuestions: selectedQuestions.length,
      quizDurationSeconds: this.quizDurationSeconds,
      deadlineAt: new Date(attempt.quizDeadlineAt).toISOString()
    };
  }

  async answerAttempt(attemptId: string, selectedAnswer: string): Promise<AnswerResponse> {
    await this.assertCanProgressByAdminControl();
    const attempt = await this.requireInProgressAttempt(attemptId);
    const now = this.now();

    this.autoSubmitIfEventEnded(attempt, now);
    this.autoSubmitIfDisconnected(attempt, now);
    this.applyTimerWindow(attempt, now);
    await this.logSubmissionAuditIfNeeded(attempt);

    if (attempt.status !== "in_progress") {
      await this.store.saveAttempt(attempt);
      return this.asSubmittedResponse(attempt, "auto_submitted");
    }

    const question = attempt.questions[attempt.currentIndex];
    const answeredInSeconds = Math.max(1, Math.ceil((now - attempt.currentQuestionShownAt) / 1000));
    const isCorrect = selectedAnswer === question.correctAnswer;
    const pointsAwarded = isCorrect ? this.pointsForTime(answeredInSeconds) : 0;

    attempt.answers.push({
      questionId: question.id,
      selectedAnswer,
      isCorrect,
      answeredAt: new Date(now).toISOString(),
      answeredInSeconds,
      pointsAwarded
    });

    attempt.score += pointsAwarded;
    attempt.currentIndex += 1;
    attempt.lastSeenAt = now;

    if (attempt.currentIndex >= attempt.questions.length) {
      this.submitAttempt(attempt, now, "completed");
      await this.logSubmissionAuditIfNeeded(attempt);
      await this.store.saveAttempt(attempt);
      return this.asSubmittedResponse(attempt, "completed");
    }

    if (attempt.graceConsumed && attempt.graceQuestionIndex !== undefined && attempt.currentIndex > attempt.graceQuestionIndex) {
      this.submitAttempt(attempt, now, "timer_expired");
      await this.logSubmissionAuditIfNeeded(attempt);
      await this.store.saveAttempt(attempt);
      return this.asSubmittedResponse(attempt, "timer_expired");
    }

    attempt.currentQuestionShownAt = now;
    await this.store.saveAttempt(attempt);

    return {
      status: attempt.status,
      score: attempt.score,
      question: this.toPublicQuestion(attempt.questions[attempt.currentIndex]),
      progress: {
        answered: attempt.answers.length,
        total: attempt.questions.length
      }
    };
  }

  async getCurrentQuestion(attemptId: string): Promise<AnswerResponse> {
    await this.assertCanProgressByAdminControl();
    const attempt = await this.requireInProgressAttempt(attemptId);
    const now = this.now();

    this.autoSubmitIfEventEnded(attempt, now);
    this.autoSubmitIfDisconnected(attempt, now);
    this.applyTimerWindow(attempt, now);
    await this.logSubmissionAuditIfNeeded(attempt);

    if (attempt.status !== "in_progress") {
      await this.store.saveAttempt(attempt);
      return this.asSubmittedResponse(attempt, "auto_submitted");
    }

    attempt.lastSeenAt = now;
    await this.store.saveAttempt(attempt);

    return {
      status: attempt.status,
      score: attempt.score,
      question: this.toPublicQuestion(attempt.questions[attempt.currentIndex]),
      progress: {
        answered: attempt.answers.length,
        total: attempt.questions.length
      }
    };
  }

  async recordHeartbeat(attemptId: string): Promise<void> {
    await this.assertCanProgressByAdminControl();
    const attempt = await this.requireInProgressAttempt(attemptId);
    attempt.lastSeenAt = this.now();
    await this.store.saveAttempt(attempt);
  }

  async recordTabSwitch(attemptId: string): Promise<AnswerResponse> {
    await this.assertCanProgressByAdminControl();
    const attempt = await this.requireInProgressAttempt(attemptId);
    const now = this.now();

    this.autoSubmitIfEventEnded(attempt, now);
    this.autoSubmitIfDisconnected(attempt, now);
    this.applyTimerWindow(attempt, now);
    await this.logSubmissionAuditIfNeeded(attempt);

    if (attempt.status !== "in_progress") {
      await this.store.saveAttempt(attempt);
      return this.asSubmittedResponse(attempt, "auto_submitted");
    }

    attempt.tabSwitchCount += 1;
    attempt.lastSeenAt = now;

    if (attempt.tabSwitchCount >= 2) {
      this.submitAttempt(attempt, now, "tab_switch_limit");
      await this.logSubmissionAuditIfNeeded(attempt);
      await this.store.saveAttempt(attempt);
      return this.asSubmittedResponse(attempt, "tab_switch_limit");
    }

    await this.logAudit({
      type: "tab_switch_warning",
      attempt,
      metadata: {
        tabSwitchCount: attempt.tabSwitchCount
      }
    });
    await this.store.saveAttempt(attempt);
    return {
      status: "in_progress",
      score: attempt.score,
      question: this.toPublicQuestion(attempt.questions[attempt.currentIndex]),
      progress: {
        answered: attempt.answers.length,
        total: attempt.questions.length
      },
      reason: "tab_switch_warning"
    };
  }

  async voidAttempt(attemptId: string, reason = "page_left"): Promise<void> {
    const attempt = await this.requireInProgressAttempt(attemptId);
    attempt.status = "void";
    attempt.voidReason = reason;
    await this.logAudit({
      type: "attempt_voided",
      attempt,
      metadata: {
        reason
      }
    });
    await this.store.deleteAttempt(attempt.id);
  }

  async getLeaderboard(limit = 20): Promise<AttemptSummary[]> {
    const attempts = await this.store.listAttempts();
    return attempts
      .filter(
        (attempt) =>
          attempt.status === "submitted" &&
          attempt.submittedAt !== undefined &&
          !attempt.isDisqualified
      )
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return (a.submittedAt ?? 0) - (b.submittedAt ?? 0);
      })
      .slice(0, limit)
      .map((attempt) => ({
        attemptId: attempt.id,
        name: attempt.name,
        email: attempt.email,
        score: attempt.score,
        submittedAt: new Date(attempt.submittedAt as number).toISOString()
      }));
  }

  async getSubmittedAttempts(): Promise<Attempt[]> {
    const attempts = await this.store.listAttempts();
    return attempts.filter((attempt) => attempt.status === "submitted");
  }

  async disqualifyAttempt(attemptId: string, actor = "admin"): Promise<Attempt> {
    const attempt = await this.store.getAttempt(attemptId);
    if (!attempt) {
      throw new QuizRuleError("Attempt not found", 404);
    }
    if (attempt.isDisqualified) {
      return attempt;
    }

    const now = this.now();
    attempt.isDisqualified = true;
    attempt.disqualifiedAt = now;
    attempt.disqualifiedBy = actor;
    attempt.voidReason = "disqualified_by_admin";
    attempt.submissionAuditLogged = true;

    if (attempt.status === "in_progress") {
      attempt.status = "submitted";
      attempt.submittedAt = now;
      attempt.score = 0;
    }

    await this.logAudit({
      type: "attempt_disqualified",
      attempt,
      metadata: {
        actor
      }
    });
    await this.store.saveAttempt(attempt);
    return attempt;
  }

  async getAuditLogs(limit = 100): Promise<AuditEvent[]> {
    return this.auditStore.list(limit);
  }

  async getEventControlState(): Promise<EventControlState> {
    return this.eventControlStore.getState();
  }

  async setEventControlState(status: EventControlStatus, actor = "admin"): Promise<EventControlState> {
    const next: EventControlState = {
      status,
      updatedAt: new Date(this.now()).toISOString(),
      updatedBy: actor
    };
    await this.eventControlStore.setState(next);
    await this.auditStore.append({
      id: uuidv4(),
      type: "event_state_changed",
      attemptId: "event",
      email: "",
      name: actor,
      at: next.updatedAt,
      metadata: {
        status
      }
    });
    return next;
  }

  async getAttemptForTesting(attemptId: string): Promise<Attempt | undefined> {
    return this.store.getAttempt(attemptId);
  }

  private selectQuestionsForAttempt(): Question[] {
    const easy = this.pickRandomByDifficulty("easy", TARGET_DISTRIBUTION.easy);
    const medium = this.pickRandomByDifficulty("medium", TARGET_DISTRIBUTION.medium);
    const hard = this.pickRandomByDifficulty("hard", TARGET_DISTRIBUTION.hard);

    const selected = [...easy, ...medium, ...hard];
    return this.shuffle(selected).map((question) => this.randomizeQuestionOptions(question));
  }

  private pickRandomByDifficulty(difficulty: "easy" | "medium" | "hard", count: number): Question[] {
    const pool = this.questionBank.filter((question) => question.difficulty === difficulty);
    if (pool.length < count) {
      throw new Error(`Insufficient question pool for difficulty '${difficulty}'`);
    }
    return this.shuffle(pool).slice(0, count);
  }

  private shuffle<T>(items: T[]): T[] {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private randomizeQuestionOptions(question: Question): Question {
    const shuffledOptions = this.shuffle(question.options);
    return {
      ...question,
      options: shuffledOptions
    };
  }

  private pointsForTime(seconds: number): number {
    for (const threshold of SCORE_THRESHOLDS) {
      if (seconds <= threshold.maxSeconds) {
        return threshold.points;
      }
    }
    return MIN_POINTS_AFTER_20_SECONDS;
  }

  private toPublicQuestion(question: Question): PublicQuestion {
    return {
      id: question.id,
      text: question.text,
      options: question.options,
      difficulty: question.difficulty
    };
  }

  private submitAttempt(attempt: Attempt, now: number, reason: string): void {
    if (attempt.status !== "in_progress") {
      return;
    }
    attempt.status = "submitted";
    attempt.submittedAt = now;
    attempt.voidReason = reason;
  }

  private applyTimerWindow(attempt: Attempt, now: number): void {
    if (attempt.status !== "in_progress") {
      return;
    }
    if (now <= attempt.quizDeadlineAt) {
      return;
    }

    if (!attempt.graceConsumed) {
      attempt.graceConsumed = true;
      attempt.graceQuestionIndex = attempt.currentIndex;
      return;
    }

    if (attempt.graceQuestionIndex !== undefined && attempt.currentIndex > attempt.graceQuestionIndex) {
      this.submitAttempt(attempt, now, "timer_expired");
    }
  }

  private autoSubmitIfDisconnected(attempt: Attempt, now: number): void {
    if (attempt.status !== "in_progress") {
      return;
    }
    if (now - attempt.lastSeenAt > this.disconnectGraceSeconds * 1000) {
      this.submitAttempt(attempt, now, "disconnect_timeout");
    }
  }

  private autoSubmitIfEventEnded(attempt: Attempt, now: number): void {
    if (attempt.status !== "in_progress") {
      return;
    }
    if (now > this.eventEndAtMs) {
      this.submitAttempt(attempt, now, "event_ended");
    }
  }

  private assertWithinEventWindowForStart(now: number): void {
    if (now < this.eventStartAtMs) {
      throw new QuizRuleError(
        `Event has not started yet. ${eventWindowMessage(this.eventStartAtMs, this.eventEndAtMs)}`,
        403
      );
    }
    if (now > this.eventEndAtMs) {
      throw new QuizRuleError(
        `Event has ended. ${eventWindowMessage(this.eventStartAtMs, this.eventEndAtMs)}`,
        403
      );
    }
  }

  private async assertCanStartByAdminControl(): Promise<void> {
    const state = await this.eventControlStore.getState();
    if (state.status === "paused") {
      throw new QuizRuleError("Event is paused by admin", 423);
    }
    if (state.status === "stopped") {
      throw new QuizRuleError("Event has been stopped by admin", 403);
    }
  }

  private async assertCanProgressByAdminControl(): Promise<void> {
    const state = await this.eventControlStore.getState();
    if (state.status === "paused") {
      throw new QuizRuleError("Event is paused by admin", 423);
    }
    if (state.status === "stopped") {
      throw new QuizRuleError("Event has been stopped by admin", 403);
    }
  }

  private async requireInProgressAttempt(attemptId: string): Promise<Attempt> {
    const attempt = await this.store.getAttempt(attemptId);
    if (!attempt) {
      throw new QuizRuleError("Attempt not found", 404);
    }
    if (attempt.status !== "in_progress") {
      throw new QuizRuleError("Attempt is no longer active", 409);
    }
    return attempt;
  }

  private asSubmittedResponse(attempt: Attempt, reason: string): AnswerResponse {
    return {
      status: attempt.status,
      score: attempt.score,
      progress: {
        answered: attempt.answers.length,
        total: attempt.questions.length
      },
      submittedAt: new Date(attempt.submittedAt ?? this.now()).toISOString(),
      reason: attempt.voidReason ?? reason
    };
  }

  private async logAudit(params: {
    type: AuditEvent["type"];
    attempt: Attempt;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<void> {
    await this.auditStore.append({
      id: uuidv4(),
      type: params.type,
      attemptId: params.attempt.id,
      email: params.attempt.email,
      name: params.attempt.name,
      at: new Date(this.now()).toISOString(),
      metadata: params.metadata
    });
  }

  private async logSubmissionAuditIfNeeded(attempt: Attempt): Promise<void> {
    if (attempt.status !== "submitted" || attempt.submissionAuditLogged) {
      return;
    }

    await this.logAudit({
      type: "attempt_submitted",
      attempt,
      metadata: {
        reason: attempt.voidReason ?? "unknown",
        score: attempt.score
      }
    });
    attempt.submissionAuditLogged = true;
  }
}
