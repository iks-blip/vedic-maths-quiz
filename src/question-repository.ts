import { getFirestore } from "firebase-admin/firestore";
import type { Question } from "./types.js";
import { loadQuestionBank } from "./question-bank.js";
import { initFirebaseApp } from "./firebase-admin.js";

export interface QuestionRepository {
  loadQuestions(): Promise<Question[]>;
}

export class MarkdownQuestionRepository implements QuestionRepository {
  constructor(private readonly markdownPath?: string) {}

  async loadQuestions(): Promise<Question[]> {
    return loadQuestionBank(this.markdownPath);
  }
}

export class FirestoreQuestionRepository implements QuestionRepository {
  private readonly db;

  constructor() {
    initFirebaseApp();
    this.db = getFirestore();
  }

  async loadQuestions(): Promise<Question[]> {
    const snapshot = await this.db.collection("questions").get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Question, "id">) }));
  }
}
