import path from "node:path";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { QuizEngine, QuizRuleError } from "./quiz-engine.js";

export function createApp(engine: QuizEngine) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/attempts/start", async (req, res, next) => {
    try {
      const payload = z
        .object({
          name: z.string().min(1),
          email: z.string().email()
        })
        .parse(req.body);

      const response = await engine.startAttempt(payload.name, payload.email);
      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/attempts/:attemptId", async (req, res, next) => {
    try {
      res.json(await engine.getCurrentQuestion(req.params.attemptId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/attempts/:attemptId/answer", async (req, res, next) => {
    try {
      const payload = z
        .object({
          selectedAnswer: z.string().min(1)
        })
        .parse(req.body);

      res.json(await engine.answerAttempt(req.params.attemptId, payload.selectedAnswer));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/attempts/:attemptId/heartbeat", async (req, res, next) => {
    try {
      await engine.recordHeartbeat(req.params.attemptId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/attempts/:attemptId/tab-switch", async (req, res, next) => {
    try {
      res.json(await engine.recordTabSwitch(req.params.attemptId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/attempts/:attemptId/void", async (req, res, next) => {
    try {
      await engine.voidAttempt(req.params.attemptId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/leaderboard", async (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      res.json({ items: await engine.getLeaderboard(limit) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/submissions", async (_req, res) => {
    res.json({ items: await engine.getSubmittedAttempts() });
  });

  app.use(express.static(path.resolve(process.cwd(), "public")));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), "public", "index.html"));
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof QuizRuleError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request payload", details: error.issues });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
