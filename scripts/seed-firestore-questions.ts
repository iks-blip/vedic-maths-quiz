import { getFirestore } from "firebase-admin/firestore";
import { loadQuestionBank } from "../src/question-bank.js";
import { initFirebaseApp } from "../src/firebase-admin.js";

async function run() {
  initFirebaseApp();
  const db = getFirestore();
  const questions = loadQuestionBank();

  const batch = db.batch();
  for (const q of questions) {
    const { id, ...rest } = q;
    batch.set(db.collection("questions").doc(id), rest);
  }

  await batch.commit();
  console.log(`Seeded ${questions.length} questions to Firestore collection 'questions'.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
