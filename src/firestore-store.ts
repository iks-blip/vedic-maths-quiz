import { getFirestore } from "firebase-admin/firestore";
import type { Attempt } from "./types.js";
import type { AttemptStore } from "./store.js";
import { initFirebaseApp } from "./firebase-admin.js";

export class FirestoreAttemptStore implements AttemptStore {
  private readonly db;

  constructor() {
    initFirebaseApp();
    this.db = getFirestore();
  }

  async getAttempt(attemptId: string): Promise<Attempt | undefined> {
    const snapshot = await this.db.collection("attempts").doc(attemptId).get();
    if (!snapshot.exists) {
      return undefined;
    }
    return snapshot.data() as Attempt;
  }

  async saveAttempt(attempt: Attempt): Promise<void> {
    await this.db.collection("attempts").doc(attempt.id).set(attempt);
  }

  async deleteAttempt(attemptId: string): Promise<void> {
    await this.db.collection("attempts").doc(attemptId).delete();
  }

  async listAttempts(): Promise<Attempt[]> {
    const snapshot = await this.db.collection("attempts").get();
    return snapshot.docs.map((doc) => doc.data() as Attempt);
  }

  async getAttemptIdByEmail(email: string): Promise<string | undefined> {
    const snapshot = await this.db.collection("attempt_email_index").doc(email).get();
    if (!snapshot.exists) {
      return undefined;
    }
    return snapshot.data()?.attemptId as string | undefined;
  }

  async setAttemptIdForEmail(email: string, attemptId: string): Promise<void> {
    await this.db.collection("attempt_email_index").doc(email).set({ attemptId });
  }

  async deleteAttemptIdForEmail(email: string): Promise<void> {
    await this.db.collection("attempt_email_index").doc(email).delete();
  }
}
