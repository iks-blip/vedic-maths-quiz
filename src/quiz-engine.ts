import { v4 as uuidv4 } from "uuid";
import {
  DISCONNECT_GRACE_SECONDS,
  MAX_CONCURRENT_ATTEMPTS,
  MIN_POINTS_AFTER_20_SECONDS,
  POWERUP_UNLOCK_STREAKS,
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
  AttemptCertificate,
  AttemptPowerups,
  AttemptSummary,
  CertificateDeliveryStatus,
  CertificateType,
  PowerupType,
  PublicQuestion,
  Question,
  StartAttemptResponse
} from "./types.js";
import { eventWindowMessage } from "./event-window.js";

export class QuizRuleError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly errorCode?: string,
    public readonly details?: Record<string, string | number | boolean>
  ) {
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
  maxConcurrentAttempts?: number;
}

export class QuizEngine {
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly quizDurationSeconds: number;
  private readonly disconnectGraceSeconds: number;
  private readonly eventStartAtMs: number;
  private readonly eventEndAtMs: number;
  private readonly maxConcurrentAttempts: number;
  private readonly waitingQueue = new Map<string, number>();

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
    this.maxConcurrentAttempts = options.maxConcurrentAttempts ?? MAX_CONCURRENT_ATTEMPTS;

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
    await this.assertQueueAvailability(normalizedEmail);

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
      answers: [],
      powerups: this.createInitialPowerups()
    };

    await this.store.saveAttempt(attempt);
    this.waitingQueue.delete(normalizedEmail);
    await this.logAudit({
      type: "attempt_started",
      attempt
    });

    return {
      attemptId,
      question: this.toPublicQuestion(selectedQuestions[0]),
      totalQuestions: selectedQuestions.length,
      quizDurationSeconds: this.quizDurationSeconds,
      deadlineAt: new Date(attempt.quizDeadlineAt).toISOString(),
      powerups: attempt.powerups
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
    let frozenDurationMs = 0;
    if (attempt.powerups.frozenQuestionId === question.id && attempt.powerups.frozenStartedAt) {
      frozenDurationMs = Math.max(0, now - attempt.powerups.frozenStartedAt);
      attempt.quizDeadlineAt += frozenDurationMs;
    }

    const answeredInSeconds = Math.max(
      1,
      Math.ceil((now - attempt.currentQuestionShownAt - frozenDurationMs) / 1000)
    );
    const rawIsCorrect = selectedAnswer === question.correctAnswer;
    const shieldedWrong =
      !rawIsCorrect && attempt.powerups.shieldArmedForQuestionId === question.id;

    let pointsAwarded = rawIsCorrect ? this.pointsForTime(answeredInSeconds) : 0;
    if (shieldedWrong) {
      pointsAwarded = MIN_POINTS_AFTER_20_SECONDS;
    }
    if (rawIsCorrect && attempt.powerups.doubleQuestionId === question.id) {
      pointsAwarded *= 2;
    }
    const isCorrect = rawIsCorrect || shieldedWrong;

    attempt.answers.push({
      questionId: question.id,
      selectedAnswer,
      isCorrect,
      answeredAt: new Date(now).toISOString(),
      answeredInSeconds,
      pointsAwarded,
      wasShielded: shieldedWrong
    });

    attempt.score += pointsAwarded;
    if (isCorrect) {
      attempt.powerups.consecutiveCorrect += 1;
    } else {
      attempt.powerups.consecutiveCorrect = 0;
    }
    this.clearPerQuestionPowerupState(attempt, question.id);
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
    if (isCorrect) {
      this.awardRandomPowerupIfMilestone(attempt, now);
    }
    await this.store.saveAttempt(attempt);

    return {
      status: attempt.status,
      score: attempt.score,
      question: this.toPublicQuestion(attempt.questions[attempt.currentIndex]),
      progress: {
        answered: attempt.answers.length,
        total: attempt.questions.length
      },
      powerups: attempt.powerups
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
      },
      powerups: attempt.powerups
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
      reason: "tab_switch_warning",
      powerups: attempt.powerups
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
    void limit;
    return [];
  }

  async getEventControlState(): Promise<EventControlState> {
    return this.eventControlStore.getState();
  }

  async getQueueStatus(email?: string): Promise<{
    activeCount: number;
    maxActive: number;
    inQueue: boolean;
    position?: number;
    canStart: boolean;
  }> {
    const normalizedEmail = email?.trim().toLowerCase();
    const activeCount = await this.getActiveAttemptCount();
    const queueEmails = [...this.waitingQueue.keys()];
    const position =
      normalizedEmail && this.waitingQueue.has(normalizedEmail)
        ? queueEmails.indexOf(normalizedEmail) + 1
        : undefined;

    const canStart =
      activeCount < this.maxConcurrentAttempts &&
      (queueEmails.length === 0 || (normalizedEmail !== undefined && queueEmails[0] === normalizedEmail));

    return {
      activeCount,
      maxActive: this.maxConcurrentAttempts,
      inQueue: position !== undefined && position > 0,
      position: position && position > 0 ? position : undefined,
      canStart
    };
  }

  async setEventControlState(status: EventControlStatus, actor = "admin"): Promise<EventControlState> {
    const next: EventControlState = {
      status,
      updatedAt: new Date(this.now()).toISOString(),
      updatedBy: actor
    };
    await this.eventControlStore.setState(next);
    return next;
  }

  async getAttemptForTesting(attemptId: string): Promise<Attempt | undefined> {
    return this.store.getAttempt(attemptId);
  }

  async issueCertificate(attemptId: string, type: CertificateType): Promise<AttemptCertificate> {
    const attempt = await this.store.getAttempt(attemptId);
    if (!attempt) {
      throw new QuizRuleError("Attempt not found", 404);
    }
    if (attempt.status !== "submitted") {
      throw new QuizRuleError("Certificate can be issued only after submission", 409);
    }
    if (attempt.isDisqualified) {
      throw new QuizRuleError("Disqualified attempt cannot receive certificate", 403);
    }
    if (attempt.certificate) {
      throw new QuizRuleError("Certificate already issued for this attempt", 409);
    }

    const certificate: AttemptCertificate = {
      certificateId: uuidv4(),
      type,
      issuedAt: new Date(this.now()).toISOString(),
      deliveryStatus: "pending"
    };
    attempt.certificate = certificate;
    await this.store.saveAttempt(attempt);
    return certificate;
  }

  async setCertificateDelivery(
    attemptId: string,
    status: CertificateDeliveryStatus,
    errorMessage?: string
  ): Promise<AttemptCertificate> {
    const attempt = await this.store.getAttempt(attemptId);
    if (!attempt) {
      throw new QuizRuleError("Attempt not found", 404);
    }
    if (!attempt.certificate) {
      throw new QuizRuleError("Certificate not issued", 404);
    }

    attempt.certificate.deliveryStatus = status;
    attempt.certificate.deliveryLastAttemptAt = new Date(this.now()).toISOString();
    if (status === "sent") {
      attempt.certificate.deliverySentAt = attempt.certificate.deliveryLastAttemptAt;
      attempt.certificate.deliveryError = undefined;
    } else if (status === "failed") {
      attempt.certificate.deliveryError = errorMessage ?? "email_send_failed";
    }
    await this.store.saveAttempt(attempt);
    return attempt.certificate;
  }

  private selectQuestionsForAttempt(): Question[] {
    const usedTexts = new Set<string>();
    const easy = this.pickRandomByDifficulty("easy", TARGET_DISTRIBUTION.easy, usedTexts);
    const medium = this.pickRandomByDifficulty("medium", TARGET_DISTRIBUTION.medium, usedTexts);
    const hard = this.pickRandomByDifficulty("hard", TARGET_DISTRIBUTION.hard, usedTexts);

    const selected = [...easy, ...medium, ...hard];
    return this.shuffle(selected).map((question) => this.randomizeQuestionOptions(question));
  }

  private pickRandomByDifficulty(
    difficulty: "easy" | "medium" | "hard",
    count: number,
    usedTexts?: Set<string>
  ): Question[] {
    const pool = this.deduplicateByText(
      this.questionBank.filter((question) => {
        if (question.difficulty !== difficulty) {
          return false;
        }
        if (!usedTexts) {
          return true;
        }
        return !usedTexts.has(this.normalizeQuestionText(question.text));
      })
    );
    if (pool.length < count) {
      throw new Error(`Insufficient question pool for difficulty '${difficulty}'`);
    }
    const picked = this.shuffle(pool).slice(0, count);
    if (usedTexts) {
      for (const question of picked) {
        usedTexts.add(this.normalizeQuestionText(question.text));
      }
    }
    return picked;
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

  private deduplicateByText(questions: Question[]): Question[] {
    const seen = new Set<string>();
    const unique: Question[] = [];
    for (const question of questions) {
      const key = this.normalizeQuestionText(question.text);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(question);
    }
    return unique;
  }

  private normalizeQuestionText(text: string): string {
    return text.trim().toLowerCase();
  }

  private createInitialPowerups(): AttemptPowerups {
    return {
      consecutiveCorrect: 0,
      awardedAtMilestones: [],
      awardedTypes: [],
      eliminatedOptionsByQuestionId: {}
    };
  }

  private ensureAttemptPowerups(attempt: Attempt): void {
    if (!attempt.powerups) {
      attempt.powerups = this.createInitialPowerups();
      return;
    }
    attempt.powerups.awardedAtMilestones ??= [];
    attempt.powerups.awardedTypes ??= [];
    attempt.powerups.eliminatedOptionsByQuestionId ??= {};
    attempt.powerups.consecutiveCorrect ??= 0;
  }

  private awardRandomPowerupIfMilestone(attempt: Attempt, now: number): void {
    const streak = attempt.powerups.consecutiveCorrect;
    const milestones: number[] = [
      POWERUP_UNLOCK_STREAKS.eliminate_two,
      POWERUP_UNLOCK_STREAKS.time_freeze,
      POWERUP_UNLOCK_STREAKS.double_score,
      POWERUP_UNLOCK_STREAKS.shield
    ];
    if (!milestones.includes(streak)) {
      return;
    }
    if (attempt.powerups.awardedAtMilestones.includes(streak)) {
      return;
    }

    attempt.powerups.awardedAtMilestones.push(streak);
    const allTypes: PowerupType[] = ["eliminate_two", "time_freeze", "double_score", "shield"];
    const availableTypes = allTypes.filter((type) => !attempt.powerups.awardedTypes.includes(type));
    if (availableTypes.length === 0) {
      return;
    }
    const type = availableTypes[Math.floor(this.random() * availableTypes.length)];
    attempt.powerups.awardedTypes.push(type);
    attempt.powerups.lastUnlockedPowerup = type;
    attempt.powerups.lastUnlockedStreak = streak;

    const nextQuestion = attempt.questions[attempt.currentIndex];
    if (!nextQuestion) {
      return;
    }

    if (type === "eliminate_two") {
      const incorrect = nextQuestion.options.filter((opt) => opt !== nextQuestion.correctAnswer);
      attempt.powerups.eliminatedOptionsByQuestionId[nextQuestion.id] = this.shuffle(incorrect).slice(0, 2);
      return;
    }
    if (type === "time_freeze") {
      attempt.powerups.frozenQuestionId = nextQuestion.id;
      attempt.powerups.frozenStartedAt = now;
      return;
    }
    if (type === "double_score") {
      attempt.powerups.doubleQuestionId = nextQuestion.id;
      return;
    }
    attempt.powerups.shieldArmedForQuestionId = nextQuestion.id;
  }

  private clearPerQuestionPowerupState(attempt: Attempt, questionId: string): void {
    if (attempt.powerups.frozenQuestionId === questionId) {
      attempt.powerups.frozenQuestionId = undefined;
      attempt.powerups.frozenStartedAt = undefined;
    }
    if (attempt.powerups.doubleQuestionId === questionId) {
      attempt.powerups.doubleQuestionId = undefined;
    }
    if (attempt.powerups.shieldArmedForQuestionId === questionId) {
      attempt.powerups.shieldArmedForQuestionId = undefined;
    }
    if (attempt.powerups.eliminatedOptionsByQuestionId[questionId]) {
      delete attempt.powerups.eliminatedOptionsByQuestionId[questionId];
    }
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
    this.ensureAttemptPowerups(attempt);
    if (attempt.status !== "in_progress") {
      throw new QuizRuleError("Attempt is no longer active", 409);
    }
    return attempt;
  }

  private async assertQueueAvailability(email: string): Promise<void> {
    const activeCount = await this.getActiveAttemptCount();
    const queueEmails = [...this.waitingQueue.keys()];
    const isQueued = this.waitingQueue.has(email);
    const isQueueActive = queueEmails.length > 0;
    const isFront = isQueued && queueEmails[0] === email;

    if (!isQueueActive && activeCount < this.maxConcurrentAttempts) {
      return;
    }

    if (isFront && activeCount < this.maxConcurrentAttempts) {
      return;
    }

    if (!isQueued) {
      this.waitingQueue.set(email, this.now());
    }

    const updatedQueue = [...this.waitingQueue.keys()];
    const position = updatedQueue.indexOf(email) + 1;
    throw new QuizRuleError("You are in a queue, please wait for your turn.", 429, "QUEUE_WAIT", {
      position,
      activeCount,
      maxActive: this.maxConcurrentAttempts
    });
  }

  private async getActiveAttemptCount(): Promise<number> {
    const attempts = await this.store.listAttempts();
    return attempts.filter((attempt) => attempt.status === "in_progress").length;
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
      reason: attempt.voidReason ?? reason,
      powerups: attempt.powerups
    };
  }

  private async logAudit(params: {
    type: AuditEvent["type"];
    attempt: Attempt;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<void> {
    void params;
  }

  private async logSubmissionAuditIfNeeded(attempt: Attempt): Promise<void> {
    if (attempt.status !== "submitted" || attempt.submissionAuditLogged) {
      return;
    }
    attempt.submissionAuditLogged = true;
  }
}
