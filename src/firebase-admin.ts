import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

interface ServiceAccountFile {
  project_id: string;
  client_email: string;
  private_key: string;
}

let firestoreConfigured = false;

function credentialsFromEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    return undefined;
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n")
  };
}

function credentialsFromFile() {
  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!serviceAccountPath) {
    return undefined;
  }
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Firebase service account file not found at ${serviceAccountPath}`);
  }

  const raw = fs.readFileSync(serviceAccountPath, "utf8");
  const parsed = JSON.parse(raw) as ServiceAccountFile;

  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error(`Invalid Firebase service account JSON at ${serviceAccountPath}`);
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key
  };
}

export function initFirebaseApp(): void {
  if (getApps().length === 0) {
    const credentials = credentialsFromEnv() ?? credentialsFromFile();

    if (!credentials) {
      throw new Error(
        "Missing Firebase credentials. Provide FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY or set FIREBASE_SERVICE_ACCOUNT_PATH/GOOGLE_APPLICATION_CREDENTIALS."
      );
    }

    initializeApp({
      credential: cert(credentials)
    });
  }

  if (!firestoreConfigured) {
    getFirestore().settings({ ignoreUndefinedProperties: true });
    firestoreConfigured = true;
  }
}
