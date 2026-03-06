import { Question } from "../src/types.js";

export function buildQuestionBank(): Question[] {
  const questions: Question[] = [];
  for (let i = 1; i <= 75; i += 1) {
    const difficulty = i <= 25 ? "easy" : i <= 50 ? "medium" : "hard";
    questions.push({
      id: `q-${i}`,
      text: `Question ${i}`,
      options: ["A", "B", "C", "D"],
      correctAnswer: "A",
      difficulty
    });
  }
  return questions;
}
