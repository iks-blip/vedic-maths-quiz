import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { QuizEngine } from "../src/quiz-engine.js";
import { InMemoryAttemptStore } from "../src/store.js";
import { InMemoryAuditStore } from "../src/audit-store.js";
import { InMemoryEventControlStore } from "../src/event-control-store.js";
import { buildQuestionBank } from "./helpers.js";

describe("API", () => {
  it("runs start -> answer -> leaderboard flow", async () => {
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
    const app = createApp(engine, { adminToken: "test-admin-token" });

    const started = await request(app)
      .post("/api/attempts/start")
      .send({ name: "Mayank", email: "mayank@example.com" })
      .expect(201);

    expect(started.body.attemptId).toBeDefined();

    now += 2_000;
    await request(app)
      .post(`/api/attempts/${started.body.attemptId}/answer`)
      .send({ selectedAnswer: "A" })
      .expect(200);

    const leaderboard = await request(app).get("/api/leaderboard").expect(200);
    expect(Array.isArray(leaderboard.body.items)).toBe(true);
  });

  it("allows multiple attempts for same email in testing mode", async () => {
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
        random: () => 0
      }
    );
    const app = createApp(engine, { adminToken: "test-admin-token" });

    await request(app)
      .post("/api/attempts/start")
      .send({ name: "One", email: "same@example.com" })
      .expect(201);

    await request(app)
      .post("/api/attempts/start")
      .send({ name: "Two", email: "same@example.com" })
      .expect(201);
  });

  it("protects admin endpoints with token", async () => {
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
        random: () => 0
      }
    );
    const app = createApp(engine, { adminToken: "secret-token" });

    await request(app).get("/api/admin/submissions").expect(401);
    await request(app)
      .get("/api/admin/submissions")
      .set("Authorization", "Bearer secret-token")
      .expect(200);
  });

  it("allows admin to disqualify an attempt", async () => {
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
    const app = createApp(engine, { adminToken: "secret-token" });

    const started = await request(app)
      .post("/api/attempts/start")
      .send({ name: "DQ", email: "dq-admin@example.com" })
      .expect(201);

    await request(app)
      .post(`/api/admin/attempts/${started.body.attemptId}/disqualify`)
      .set("Authorization", "Bearer secret-token")
      .send({ actor: "test" })
      .expect(200);

    const leaderboard = await request(app)
      .get("/api/admin/leaderboard")
      .set("Authorization", "Bearer secret-token")
      .expect(200);

    expect(leaderboard.body.items.find((x: { attemptId: string }) => x.attemptId === started.body.attemptId)).toBeUndefined();
  });

  it("allows admin to control event state", async () => {
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore()
    );
    const app = createApp(engine, { adminToken: "secret-token" });

    await request(app)
      .post("/api/admin/event-state")
      .set("Authorization", "Bearer secret-token")
      .send({ status: "paused", actor: "test_admin" })
      .expect(200);

    const state = await request(app).get("/api/event-state").expect(200);
    expect(state.body.status).toBe("paused");
  });

  it("returns queue wait response when active capacity is full", async () => {
    const engine = new QuizEngine(
      buildQuestionBank(),
      new InMemoryAttemptStore(),
      new InMemoryAuditStore(),
      new InMemoryEventControlStore(),
      {
        maxConcurrentAttempts: 1
      }
    );
    const app = createApp(engine, { adminToken: "secret-token" });

    await request(app)
      .post("/api/attempts/start")
      .send({ name: "One", email: "one@example.com" })
      .expect(201);

    const queued = await request(app)
      .post("/api/attempts/start")
      .send({ name: "Two", email: "two@example.com" })
      .expect(429);

    expect(queued.body.code).toBe("QUEUE_WAIT");

    const queueStatus = await request(app)
      .get("/api/queue/status")
      .query({ email: "two@example.com" })
      .expect(200);

    expect(queueStatus.body.inQueue).toBe(true);
    expect(queueStatus.body.position).toBe(1);
  });
});
