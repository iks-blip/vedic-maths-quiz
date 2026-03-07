import { describe, expect, it } from "vitest";
import { QuizEngine } from "../src/quiz-engine.js";
import { InMemoryAttemptStore } from "../src/store.js";
import { InMemoryAuditStore } from "../src/audit-store.js";
import { InMemoryEventControlStore } from "../src/event-control-store.js";
import { buildQuestionBank } from "./helpers.js";

describe("QuizEngine", () => {
  it("selects 25 questions with 5/5/15 difficulty split and no repeated texts", async () => {
    let now = 1_000;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
      now: () => now,
      random: () => 0.01
      }
    );

    const started = await engine.startAttempt("A", "a@example.com");
    const attempt = await engine.getAttemptForTesting(started.attemptId);
    expect(attempt).toBeDefined();
    expect(attempt?.questions.length).toBe(25);
    expect(attempt?.questions.filter((q) => q.difficulty === "easy").length).toBe(5);
    expect(attempt?.questions.filter((q) => q.difficulty === "medium").length).toBe(5);
    expect(attempt?.questions.filter((q) => q.difficulty === "hard").length).toBe(15);

    const normalizedTexts = attempt?.questions.map((q) => q.text.trim().toLowerCase()) ?? [];
    expect(new Set(normalizedTexts).size).toBe(normalizedTexts.length);
  });

  it("shuffles options so correct answer is not fixed to option A position", async () => {
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
      now: () => 1_000,
      random: () => 0
      }
    );

    const started = await engine.startAttempt("A", "shuffle@example.com");
    const attempt = await engine.getAttemptForTesting(started.attemptId);
    expect(attempt).toBeDefined();

    const hasQuestionWithMovedCorrectOption = attempt!.questions.some(
      (q) => q.options[0] !== q.correctAnswer
    );
    expect(hasQuestionWithMovedCorrectOption).toBe(true);
  });

  it("awards score based on answer speed", async () => {
    let now = 1_000;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
      now: () => now,
      random: () => 0
      }
    );

    const started = await engine.startAttempt("A", "speed@example.com");

    now += 9_000;
    let response = await engine.answerAttempt(started.attemptId, "A");
    expect(response.score).toBe(40);

    now += 12_000;
    response = await engine.answerAttempt(started.attemptId, "A");
    expect(response.score).toBe(80);

    now += 16_000;
    response = await engine.answerAttempt(started.attemptId, "A");
    expect(response.score).toBe(120);

    now += 25_000;
    response = await engine.answerAttempt(started.attemptId, "A");
    expect(response.score).toBe(152);

    now += 55_000;
    response = await engine.answerAttempt(started.attemptId, "A");
    expect(response.score).toBe(168);

    now += 5_000;
    response = await engine.answerAttempt(started.attemptId, "B");
    expect(response.score).toBe(168);
  });

  it("auto-submits on second tab switch", async () => {
    let now = 1_000;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
      now: () => now
      }
    );

    const started = await engine.startAttempt("A", "tabs@example.com");
    const first = await engine.recordTabSwitch(started.attemptId);
    expect(first.reason).toBe("tab_switch_warning");

    now += 100;
    const second = await engine.recordTabSwitch(started.attemptId);
    expect(second.status).toBe("submitted");
    expect(second.reason).toBe("tab_switch_limit");
  });

  it("allows one-question grace after timer expiry", async () => {
    let now = 0;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
      now: () => now,
      quizDurationSeconds: 20
      }
    );

    const started = await engine.startAttempt("A", "timer@example.com");

    now = 21_000;
    const firstAfterExpiry = await engine.answerAttempt(started.attemptId, "A");
    expect(firstAfterExpiry.status).toBe("submitted");
    expect(firstAfterExpiry.reason).toBe("timer_expired");
  });

  it("auto-submits when disconnect grace exceeded", async () => {
    let now = 0;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
      now: () => now,
      disconnectGraceSeconds: 2
      }
    );

    const started = await engine.startAttempt("A", "net@example.com");

    now = 3_100;
    const status = await engine.getCurrentQuestion(started.attemptId);
    expect(status.status).toBe("submitted");
  });

  it("sorts leaderboard by score desc then earliest submit", async () => {
    let now = 0;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
      now: () => now,
      random: () => 0
      }
    );

    const a = await engine.startAttempt("A", "lead-a@example.com");
    const b = await engine.startAttempt("B", "lead-b@example.com");

    for (let i = 0; i < 25; i += 1) {
      now += 1_000;
      await engine.answerAttempt(a.attemptId, "A");
      now += 1_000;
      await engine.answerAttempt(b.attemptId, i < 24 ? "A" : "B");
    }

    const leaderboard = await engine.getLeaderboard(2);
    expect(leaderboard[0].name).toBe("A");
    expect(leaderboard[1].name).toBe("B");
  });

  it("excludes disqualified attempts from leaderboard", async () => {
    let now = 0;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
      now: () => now,
      random: () => 0
      }
    );

    const started = await engine.startAttempt("A", "dq@example.com");
    for (let i = 0; i < 25; i += 1) {
      now += 1_000;
      await engine.answerAttempt(started.attemptId, "A");
    }

    await engine.disqualifyAttempt(started.attemptId, "tester");
    const leaderboard = await engine.getLeaderboard(10);
    expect(leaderboard.find((x) => x.attemptId === started.attemptId)).toBeUndefined();
  });

  it("blocks quiz start before event window", async () => {
    const now = 1_000;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
      now: () => now,
      eventStartAtMs: 2_000,
      eventEndAtMs: 10_000
      }
    );

    await expect(engine.startAttempt("A", "early@example.com")).rejects.toThrow("Event has not started yet");
  });

  it("auto-submits active attempt after event end", async () => {
    let now = 3_000;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
      now: () => now,
      eventStartAtMs: 1_000,
      eventEndAtMs: 5_000
      }
    );

    const started = await engine.startAttempt("A", "window@example.com");
    now = 6_000;
    const response = await engine.getCurrentQuestion(started.attemptId);
    expect(response.status).toBe("submitted");
    expect(response.reason).toBe("event_ended");
  });

  it("blocks quiz progression when admin pauses event", async () => {
    let now = 1_000;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
        now: () => now
      }
    );

    const started = await engine.startAttempt("A", "pause@example.com");
    await engine.setEventControlState("paused", "tester");
    await expect(engine.getCurrentQuestion(started.attemptId)).rejects.toThrow("Event is paused by admin");
  });

  it("queues users when active attempt capacity is full", async () => {
    let now = 1_000;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
        now: () => now,
        maxConcurrentAttempts: 1
      }
    );

    const first = await engine.startAttempt("A", "one@example.com");
    await expect(engine.startAttempt("B", "two@example.com")).rejects.toMatchObject({
      statusCode: 429,
      errorCode: "QUEUE_WAIT"
    });

    const queueStatus = await engine.getQueueStatus("two@example.com");
    expect(queueStatus.inQueue).toBe(true);
    expect(queueStatus.position).toBe(1);
    expect(queueStatus.canStart).toBe(false);

    await engine.disqualifyAttempt(first.attemptId, "tester");
    const queueStatusAfter = await engine.getQueueStatus("two@example.com");
    expect(queueStatusAfter.canStart).toBe(true);
  });

  it("awards random power-ups at 5, 10, 15, 20 consecutive correct answers", async () => {
    let now = 0;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      { now: () => now, random: () => 0 }
    );

    const started = await engine.startAttempt("P", "power@example.com");
    const expectedMilestones = [5, 10, 15, 20];
    const expectedTypes = ["eliminate_two", "time_freeze", "double_score", "shield"] as const;
    for (let i = 1; i <= 20; i += 1) {
      now += 2_000;
      const response = await engine.answerAttempt(started.attemptId, "A");
      if (expectedMilestones.includes(i)) {
        const milestoneIndex = expectedMilestones.indexOf(i);
        expect(response.powerups?.awardedAtMilestones).toContain(i);
        expect(response.powerups?.lastUnlockedStreak).toBe(i);
        expect(response.powerups?.lastUnlockedPowerup).toBe(expectedTypes[milestoneIndex]);
      }
    }
  });

  it("does not repeat an awarded power-up type in a single attempt", async () => {
    let now = 0;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      { now: () => now, random: () => 0 }
    );

    const started = await engine.startAttempt("P", "norepeat@example.com");
    for (let i = 0; i < 20; i += 1) {
      now += 2_000;
      await engine.answerAttempt(started.attemptId, "A");
    }
    const current = await engine.getCurrentQuestion(started.attemptId);
    const awarded = current.powerups?.awardedTypes ?? [];
    expect(awarded.length).toBe(4);
    expect(new Set(awarded).size).toBe(4);
  });

  it("applies random awarded eliminate-two power-up to next question", async () => {
    let now = 0;
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      { now: () => now, random: () => 0 }
    );
    const started = await engine.startAttempt("P", "double@example.com");
    let response = await engine.getCurrentQuestion(started.attemptId);

    for (let i = 0; i < 5; i += 1) {
      now += 2_000;
      response = await engine.answerAttempt(started.attemptId, "A");
    }
    expect(response.powerups?.lastUnlockedPowerup).toBe("eliminate_two");
    const hidden = response.powerups?.eliminatedOptionsByQuestionId?.[response.question!.id] ?? [];
    expect(hidden.length).toBe(2);
    expect(new Set(hidden).size).toBe(2);
    for (const option of hidden) {
      expect(response.question?.options).toContain(option);
    }
  });
});
