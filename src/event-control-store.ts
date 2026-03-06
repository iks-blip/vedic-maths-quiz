export type EventControlStatus = "active" | "paused" | "stopped";

export interface EventControlState {
  status: EventControlStatus;
  updatedAt: string;
  updatedBy: string;
}

export interface EventControlStore {
  getState(): Promise<EventControlState>;
  setState(next: EventControlState): Promise<void>;
}

export class InMemoryEventControlStore implements EventControlStore {
  private state: EventControlState = {
    status: "active",
    updatedAt: new Date(0).toISOString(),
    updatedBy: "system"
  };

  async getState(): Promise<EventControlState> {
    return this.state;
  }

  async setState(next: EventControlState): Promise<void> {
    this.state = next;
  }
}
