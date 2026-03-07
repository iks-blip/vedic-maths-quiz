export const QUIZ_DURATION_SECONDS = 20 * 60;
export const DISCONNECT_GRACE_SECONDS = 60;
export const QUESTIONS_PER_ATTEMPT = 25;
export const TARGET_DISTRIBUTION = {
  easy: 6,
  medium: 9,
  hard: 10
} as const;

export const SCORE_THRESHOLDS = [
  { maxSeconds: 10, points: 10 },
  { maxSeconds: 15, points: 8 },
  { maxSeconds: 20, points: 6 }
] as const;

export const MIN_POINTS_AFTER_20_SECONDS = 4;
export const CERTIFICATE_MIN_SCORE = 180;
