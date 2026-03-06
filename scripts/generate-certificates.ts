import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { CERTIFICATE_MIN_SCORE } from "../src/config.js";

interface Submission {
  id: string;
  name: string;
  score: number;
  submittedAt?: number;
}

interface SubmissionPayload {
  items: Submission[];
}

const inputPath = process.argv[2] ?? path.resolve(process.cwd(), "submissions.json");
const outputPath = process.argv[3] ?? path.resolve(process.cwd(), "certificates.json");

const payload = JSON.parse(fs.readFileSync(inputPath, "utf8")) as SubmissionPayload;
const issueDate = new Date().toISOString().slice(0, 10);

const certificates = payload.items
  .filter((item) => item.score >= CERTIFICATE_MIN_SCORE)
  .map((item) => ({
    certificateId: uuidv4(),
    name: item.name,
    score: item.score,
    issuedDate: issueDate
  }));

fs.writeFileSync(outputPath, JSON.stringify({ items: certificates }, null, 2), "utf8");
console.log(`Generated ${certificates.length} certificates at ${outputPath}`);
