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
  const sectionRegex = /##\s*(Easy|Medium|Hard)\s*\(\d+(?:\s*Questions)?\)(?:\s*---[^\n]*)?\s*([\s\S]*?)(?=\n##\s*(Easy|Medium|Hard)\s*\(|$)/gi;

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
    const blocks = section.body
      .split(/###\s*Q(\d+)\s*/g)
      .slice(1);

    for (let i = 0; i < blocks.length; i += 2) {
      const number = Number(blocks[i]);
      const blockBody = blocks[i + 1] ?? "";
      const textMatch = blockBody.match(/\*\*(?!Answer:)([\s\S]*?)\*\*/i);
      const text = textMatch?.[1]?.trim();
      if (!text) {
        throw new Error(`Unable to parse question text for Q${number}`);
      }

      const optionLines = blockBody
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[A-D]\)/.test(line));

      if (optionLines.length !== 4) {
        throw new Error(`Expected 4 options, found ${optionLines.length} for Q${number}`);
      }

      const answerMatch = blockBody.match(/\*\*Answer:\*\*\s*([A-D])/i);
      const answerLetter = answerMatch?.[1];
      if (!answerLetter) {
        throw new Error(`Missing answer marker for Q${number}`);
      }

      const options = optionLines.map(extractOptionText);
      const correctIndex = ["A", "B", "C", "D"].indexOf(answerLetter);
      if (correctIndex < 0) {
        throw new Error(`Invalid answer marker '${answerLetter}' for Q${number}`);
      }

      questions.push({
        id: `q-${number}`,
        text,
        options,
        correctAnswer: options[correctIndex],
        difficulty: section.difficulty
      });
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
  const defaultNewBank = path.resolve(process.cwd(), "vedic-maths-vedic-tricks-100q.md");
  const defaultLegacyBank = path.resolve(process.cwd(), "vedic-maths-question-bank-75.md");

  const resolvedPath =
    markdownPath ?? (fs.existsSync(defaultNewBank) ? defaultNewBank : defaultLegacyBank);
  const raw = fs.readFileSync(resolvedPath, "utf8");

  if (/##\s*(Easy|Medium|Hard)\s*\(\d+/i.test(raw) && /###\s*Q\d+/i.test(raw)) {
    return parseSectionedQuestionBank(raw);
  }

  return parseLegacyQuestionBank(raw);
}
