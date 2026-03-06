import type { AuditEvent } from "./types.js";

export interface AuditStore {
  append(event: AuditEvent): Promise<void>;
  list(limit?: number): Promise<AuditEvent[]>;
}

export class InMemoryAuditStore implements AuditStore {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    return [...this.events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
}
