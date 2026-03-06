import { getFirestore } from "firebase-admin/firestore";
import { initFirebaseApp } from "./firebase-admin.js";
import type { AuditStore } from "./audit-store.js";
import type { AuditEvent } from "./types.js";

export class FirestoreAuditStore implements AuditStore {
  private readonly db;

  constructor() {
    initFirebaseApp();
    this.db = getFirestore();
  }

  async append(event: AuditEvent): Promise<void> {
    await this.db.collection("audit_logs").doc(event.id).set(event);
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    const snapshot = await this.db
      .collection("audit_logs")
      .orderBy("at", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => doc.data() as AuditEvent);
  }
}
