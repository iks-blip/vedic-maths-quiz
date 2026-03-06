import path from "node:path";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { QuizEngine, QuizRuleError } from "./quiz-engine.js";
import type { Attempt } from "./types.js";

interface AppOptions {
  adminToken: string;
}

function parseBearerToken(headerValue: string | undefined): string | undefined {
  if (!headerValue) {
    return undefined;
  }
  const [scheme, token] = headerValue.split(" ");
  if (scheme?.toLowerCase() !== "bearer") {
    return undefined;
  }
  return token;
}

function toCsv(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes("\"")) {
    return `"${value.replace(/\"/g, '""')}"`;
  }
  return value;
}

function createRateLimiter(windowMs: number, maxRequests: number): express.RequestHandler {
  const bucket = new Map<string, number[]>();

  return (req, res, next) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const floor = now - windowMs;
    const timestamps = (bucket.get(key) ?? []).filter((ts) => ts >= floor);

    if (timestamps.length >= maxRequests) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    timestamps.push(now);
    bucket.set(key, timestamps);
    next();
  };
}

function suspiciousReasonsForAttempt(attempt: Attempt): string[] {
  const reasons: string[] = [];

  if (attempt.tabSwitchCount >= 1) {
    reasons.push(`tab_switches_${attempt.tabSwitchCount}`);
  }
  if (attempt.isDisqualified) {
    reasons.push("disqualified");
  }
  if (attempt.answers.length > 0) {
    const veryFastCount = attempt.answers.filter((a) => a.answeredInSeconds <= 2).length;
    if (veryFastCount >= 5) {
      reasons.push(`very_fast_answers_${veryFastCount}`);
    }
  }

  return reasons;
}

export function createApp(engine: QuizEngine, options: AppOptions) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const publicRateLimit = createRateLimiter(60_000, 180);
  const adminRateLimit = createRateLimiter(60_000, 240);

  const requireAdminAuth: express.RequestHandler = (req, res, next) => {
    const bearer = parseBearerToken(req.headers.authorization);
    const token = bearer ?? (typeof req.headers["x-admin-token"] === "string" ? req.headers["x-admin-token"] : undefined);

    if (!token || token !== options.adminToken) {
      res.status(401).json({ error: "Unauthorized admin access" });
      return;
    }
    next();
  };

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/event-state", async (_req, res, next) => {
    try {
      res.json(await engine.getEventControlState());
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/attempts", publicRateLimit);
  app.use("/api/admin", adminRateLimit);

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

  app.get("/api/admin/submissions", requireAdminAuth, async (_req, res) => {
    const items = await engine.getSubmittedAttempts();
    res.json({
      items: items.map((attempt) => {
        const suspiciousReasons = suspiciousReasonsForAttempt(attempt);
        return {
          ...attempt,
          suspicious: suspiciousReasons.length > 0,
          suspiciousReasons
        };
      })
    });
  });

  app.get("/api/admin/event-state", requireAdminAuth, async (_req, res) => {
    res.json(await engine.getEventControlState());
  });

  app.post("/api/admin/event-state", requireAdminAuth, async (req, res, next) => {
    try {
      const payload = z
        .object({
          status: z.enum(["active", "paused", "stopped"]),
          actor: z.string().trim().min(1).optional()
        })
        .parse(req.body ?? {});

      const nextState = await engine.setEventControlState(payload.status, payload.actor ?? "admin");
      res.json({ ok: true, state: nextState });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/attempts/:attemptId/disqualify", requireAdminAuth, async (req, res, next) => {
    try {
      const parsed = z
        .object({
          actor: z.string().trim().min(1).optional()
        })
        .safeParse(req.body ?? {});
      const actor = parsed.success ? (parsed.data.actor ?? "admin") : "admin";
      const updated = await engine.disqualifyAttempt(String(req.params.attemptId), actor);
      res.json({ ok: true, item: updated });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/leaderboard", requireAdminAuth, async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    res.json({ items: await engine.getLeaderboard(limit) });
  });

  app.get("/api/admin/audit-logs", requireAdminAuth, async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    res.json({ items: await engine.getAuditLogs(limit) });
  });

  app.get("/api/admin/submissions.csv", requireAdminAuth, async (_req, res) => {
    const submissions = await engine.getSubmittedAttempts();
    const header = ["attempt_id", "name", "email", "score", "submitted_at", "reason", "disqualified"].join(",");
    const rows = submissions
      .map((item) =>
        [
          item.id,
          toCsv(item.name),
          toCsv(item.email),
          String(item.score),
          item.submittedAt ? new Date(item.submittedAt).toISOString() : "",
          toCsv(item.voidReason ?? ""),
          String(Boolean(item.isDisqualified))
        ].join(",")
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=submissions.csv");
    res.send(`${header}\n${rows}`);
  });

  app.use(express.static(path.resolve(process.cwd(), "public")));
  app.get("/admin", (_req, res) => {
    res.sendFile(path.resolve(process.cwd(), "public", "admin.html"));
  });

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
