import { getFirestore } from "firebase-admin/firestore";
import { initFirebaseApp } from "./firebase-admin.js";
import type { EventControlState, EventControlStore } from "./event-control-store.js";

const DOC_ID = "global";

export class FirestoreEventControlStore implements EventControlStore {
  private readonly db;

  constructor() {
    initFirebaseApp();
    this.db = getFirestore();
  }

  async getState(): Promise<EventControlState> {
    const snapshot = await this.db.collection("event_control").doc(DOC_ID).get();
    if (!snapshot.exists) {
      return {
        status: "active",
        updatedAt: new Date(0).toISOString(),
        updatedBy: "system"
      };
    }

    return snapshot.data() as EventControlState;
  }

  async setState(next: EventControlState): Promise<void> {
    await this.db.collection("event_control").doc(DOC_ID).set(next);
  }
}
