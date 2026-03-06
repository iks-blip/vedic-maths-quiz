import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { QuizEngine } from "../src/quiz-engine.js";
import { InMemoryAttemptStore } from "../src/store.js";
import { buildQuestionBank } from "./helpers.js";

describe("API", () => {
  it("runs start -> answer -> leaderboard flow", async () => {
    let now = 0;
    const engine = new QuizEngine(buildQuestionBank(), new InMemoryAttemptStore(), { now: () => now, random: () => 0 });
    const app = createApp(engine);

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
    const engine = new QuizEngine(buildQuestionBank(), new InMemoryAttemptStore(), { random: () => 0 });
    const app = createApp(engine);

    await request(app)
      .post("/api/attempts/start")
      .send({ name: "One", email: "same@example.com" })
      .expect(201);

    await request(app)
      .post("/api/attempts/start")
      .send({ name: "Two", email: "same@example.com" })
      .expect(201);
  });
});
