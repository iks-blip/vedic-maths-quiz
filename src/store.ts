import type { Attempt } from "./types.js";

export interface AttemptStore {
  getAttempt(attemptId: string): Promise<Attempt | undefined>;
  saveAttempt(attempt: Attempt): Promise<void>;
  deleteAttempt(attemptId: string): Promise<void>;
  listAttempts(): Promise<Attempt[]>;
  getAttemptIdByEmail(email: string): Promise<string | undefined>;
  setAttemptIdForEmail(email: string, attemptId: string): Promise<void>;
  deleteAttemptIdForEmail(email: string): Promise<void>;
}

export class InMemoryAttemptStore implements AttemptStore {
  private readonly attempts = new Map<string, Attempt>();
  private readonly emailAttemptMap = new Map<string, string>();

  async getAttempt(attemptId: string): Promise<Attempt | undefined> {
    return this.attempts.get(attemptId);
  }

  async saveAttempt(attempt: Attempt): Promise<void> {
    this.attempts.set(attempt.id, attempt);
  }

  async deleteAttempt(attemptId: string): Promise<void> {
    this.attempts.delete(attemptId);
  }

  async listAttempts(): Promise<Attempt[]> {
    return [...this.attempts.values()];
  }

  async getAttemptIdByEmail(email: string): Promise<string | undefined> {
    return this.emailAttemptMap.get(email);
  }

  async setAttemptIdForEmail(email: string, attemptId: string): Promise<void> {
    this.emailAttemptMap.set(email, attemptId);
  }

  async deleteAttemptIdForEmail(email: string): Promise<void> {
    this.emailAttemptMap.delete(email);
  }
}
