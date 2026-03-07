import fs from "node:fs";
import path from "node:path";
import { Difficulty, Question } from "./types.js";

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

function parseLegacyQuestionChunk(chunk: string): Omit<Question, "difficulty" | "id"> {
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

function parseLegacyQuestionBank(raw: string): Question[] {
  const chunks = raw
    .split(/### Question\s+\d+/g)
    .slice(1)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (chunks.length !== 75) {
    throw new Error(`Expected 75 questions but found ${chunks.length}`);
  }

  return chunks.map((chunk, i) => {
    const parsed = parseLegacyQuestionChunk(chunk);
    const number = i + 1;
    return {
      id: `q-${number}`,
      difficulty: difficultyForQuestionIndex(number),
      ...parsed
    };
  });
}

function parseSectionedQuestionBank(raw: string): Question[] {
  const sections: Array<{ difficulty: Difficulty; body: string }> = [];
  const sectionRegex = /##\s*(Easy|Medium|Hard)\s*\(\d+\s*Questions\)\s*([\s\S]*?)(?=\n##\s*(Easy|Medium|Hard)\s*\(|$)/g;

  let sectionMatch = sectionRegex.exec(raw);
  while (sectionMatch) {
    const label = sectionMatch[1].toLowerCase() as Difficulty;
    sections.push({ difficulty: label, body: sectionMatch[2] });
    sectionMatch = sectionRegex.exec(raw);
  }

  if (sections.length === 0) {
    throw new Error("No difficulty sections found in question bank");
  }

  const questions: Question[] = [];

  for (const section of sections) {
    const questionRegex = /\*\*Q(\d+)\.\s*([\s\S]*?)\*\*\s*([\s\S]*?)\*\*Answer:\*\*\s*([A-D])/g;
    let match = questionRegex.exec(section.body);

    while (match) {
      const number = Number(match[1]);
      const text = match[2].trim();
      const questionBody = match[3];
      const answerLetter = match[4];

      const optionLines = questionBody
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[A-D]\)/.test(line));

      if (optionLines.length !== 4) {
        throw new Error(`Expected 4 options, found ${optionLines.length} for Q${number}`);
      }

      const options = optionLines.map(extractOptionText);
      const correctIndex = ["A", "B", "C", "D"].indexOf(answerLetter);

      questions.push({
        id: `q-${number}`,
        text,
        options,
        correctAnswer: options[correctIndex],
        difficulty: section.difficulty
      });

      match = questionRegex.exec(section.body);
    }
  }

  if (questions.length === 0) {
    throw new Error("No questions parsed from sectioned question bank");
  }

  const uniqueIds = new Set(questions.map((q) => q.id));
  if (uniqueIds.size !== questions.length) {
    throw new Error("Duplicate question IDs found in sectioned question bank");
  }

  return questions;
}

export function loadQuestionBank(markdownPath?: string): Question[] {
  const defaultNewBank = path.resolve(process.cwd(), "vedic-maths-100-20easy-30med-50hard.md");
  const defaultLegacyBank = path.resolve(process.cwd(), "vedic-maths-question-bank-75.md");

  const resolvedPath =
    markdownPath ?? (fs.existsSync(defaultNewBank) ? defaultNewBank : defaultLegacyBank);
  const raw = fs.readFileSync(resolvedPath, "utf8");

  if (/##\s*Easy\s*\(\d+\s*Questions\)/i.test(raw) && /\*\*Q\d+\./.test(raw)) {
    return parseSectionedQuestionBank(raw);
  }

  return parseLegacyQuestionBank(raw);
}
