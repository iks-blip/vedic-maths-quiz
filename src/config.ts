export const QUIZ_DURATION_SECONDS = 20 * 60;
export const DISCONNECT_GRACE_SECONDS = 60;
export const QUESTIONS_PER_ATTEMPT = 25;
export const MAX_CONCURRENT_ATTEMPTS = 17;
export const TARGET_DISTRIBUTION = {
  easy: 5,
  medium: 5,
  hard: 15
} as const;

export const SCORE_THRESHOLDS = [
  { maxSeconds: 20, points: 40 },
  { maxSeconds: 32, points: 32 },
  { maxSeconds: 48, points: 24 }
] as const;

export const MIN_POINTS_AFTER_20_SECONDS = 16;
export const CERTIFICATE_MIN_SCORE = 180;

export const POWERUP_UNLOCK_STREAKS = {
  eliminate_two: 5,
  time_freeze: 10,
  double_score: 15,
  shield: 20
} as const;
