import fs from "node:fs";
import path from "node:path";
import { Question, Difficulty } from "./types.js";

function difficultyForQuestionIndex(indexOneBased: number): Difficulty {
  if (indexOneBased <= 25) {
    return "easy";
  }
  if (indexOneBased <= 50) {
    return "medium";
  }
  return "hard";
}

function extractOptionText(optionLine: string): string {
  return optionLine.replace(/^[A-D]\)\s*/, "").replace(/\\$/, "").trim();
}

function parseQuestionChunk(chunk: string): Omit<Question, "difficulty" | "id"> {
  const lines = chunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const textLine = lines.find((line) => line.startsWith("**What is"));
  if (!textLine) {
    throw new Error(`Unable to parse question text from chunk: ${chunk.slice(0, 80)}`);
  }

  const text = textLine.replace(/^\*\*/, "").replace(/\*\*$/, "").trim();
  const optionLines = lines.filter((line) => /^[A-D]\)/.test(line));
  if (optionLines.length !== 4) {
    throw new Error(`Expected 4 options, found ${optionLines.length} in chunk: ${text}`);
  }

  const answerLine = lines.find((line) => line.startsWith("**Answer:**"));
  if (!answerLine) {
    throw new Error(`Missing answer for question: ${text}`);
  }

  const answerMatch = answerLine.match(/\*\*Answer:\*\*\s*([A-D])/);
  const answerLetter = answerMatch?.[1];
  if (!answerLetter) {
    throw new Error(`Invalid answer marker '${answerLetter}' for question: ${text}`);
  }

  const options = optionLines.map(extractOptionText);
  const correctIndex = ["A", "B", "C", "D"].indexOf(answerLetter);

  return {
    text,
    options,
    correctAnswer: options[correctIndex]
  };
}

export function loadQuestionBank(markdownPath?: string): Question[] {
  const resolvedPath = markdownPath ?? path.resolve(process.cwd(), "vedic-maths-question-bank-75.md");
  const raw = fs.readFileSync(resolvedPath, "utf8");

  const chunks = raw
    .split(/### Question\s+\d+/g)
    .slice(1)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (chunks.length !== 75) {
    throw new Error(`Expected 75 questions but found ${chunks.length}`);
  }

  return chunks.map((chunk, i) => {
    const parsed = parseQuestionChunk(chunk);
    const number = i + 1;
    return {
      id: `q-${number}`,
      difficulty: difficultyForQuestionIndex(number),
      ...parsed
    };
  });
}
