import { createApp } from "./app.js";
import { FirestoreQuestionRepository, MarkdownQuestionRepository } from "./question-repository.js";
import { QuizEngine } from "./quiz-engine.js";
import { FirestoreAttemptStore } from "./firestore-store.js";
import { InMemoryAttemptStore } from "./store.js";
import { getEventWindowMs } from "./event-window.js";
import { FirestoreAuditStore } from "./firestore-audit-store.js";
import { InMemoryAuditStore } from "./audit-store.js";
import { FirestoreEventControlStore } from "./firestore-event-control-store.js";
import { InMemoryEventControlStore } from "./event-control-store.js";

async function bootstrap() {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  const useFirebase = process.env.USE_FIREBASE === "1";

  const questionRepository = useFirebase ? new FirestoreQuestionRepository() : new MarkdownQuestionRepository();
  const attemptStore = useFirebase ? new FirestoreAttemptStore() : new InMemoryAttemptStore();
  const auditStore = useFirebase ? new FirestoreAuditStore() : new InMemoryAuditStore();
  const eventControlStore = useFirebase ? new FirestoreEventControlStore() : new InMemoryEventControlStore();

  const questionBank = await questionRepository.loadQuestions();
  const eventWindow = getEventWindowMs();
  const engine = new QuizEngine(questionBank, attemptStore, auditStore, eventControlStore, {
    eventStartAtMs: eventWindow.startAtMs,
    eventEndAtMs: eventWindow.endAtMs
  });
  const app = createApp(engine, {
    adminToken: process.env.ADMIN_TOKEN ?? "admin-dev-token"
  });

  const lanUrl = process.env.LAN_URL;

  app.listen(port, host, () => {
    console.log(`Vedic Maths quiz server running on http://localhost:${port}`);
    if (lanUrl) {
      console.log(`LAN URL: ${lanUrl}`);
    }
    console.log(`Persistence mode: ${useFirebase ? "firebase" : "in-memory"}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
