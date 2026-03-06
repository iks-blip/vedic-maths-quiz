# Vedic Maths Quiz (Phase 1 MVP)

Feature-first implementation of the `vedic-maths-quiz.spec.md` requirements.

## Stack
- Backend: Node.js + Express + TypeScript
- Domain logic: `src/quiz-engine.ts`
- Frontend: static HTML/CSS/JS in `public/`
- Tests: Vitest + Supertest

## Run
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.

## Firebase Mode
To use Firestore for questions + attempts + leaderboard:

```bash
export FIREBASE_SERVICE_ACCOUNT_PATH="/Users/mayankatri/.codex/memories/secrets/vedic-maths-firebase-adminsdk.json"
npm run seed:questions:firebase
npm run dev:firebase
```

Credential loading order:
- Env vars (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`)
- Or explicit service account file path via `FIREBASE_SERVICE_ACCOUNT_PATH` or `GOOGLE_APPLICATION_CREDENTIALS`

Optional:
- Prefer keeping service account JSON outside this repository.

## Event Window (Nashik / IST)
- Default enforced window: `2026-03-14 00:00 IST` to `2026-03-14 12:00 IST`
- Override if needed:
```bash
export EVENT_START_AT_IST="2026-03-14T00:00:00+05:30"
export EVENT_END_AT_IST="2026-03-14T12:00:00+05:30"
```

## Test
```bash
npm test
npm run build
```

## Implemented Rules
- 25-question attempts from 75-bank with difficulty split 8 easy / 9 medium / 8 hard
- Random question selection and random order
- One question at a time, no back-navigation
- Time-based scoring: 10/8/6/4 and 0 for wrong answers
- 20-minute global timer with one-question grace after expiry
- One attempt per email (active/submitted)
- Tab switch policy: warning on first, auto-submit on second
- Disconnect grace: auto-submit if inactive beyond 60 seconds
- Resume policy via `pagehide` beacon: in-progress attempt voided and email unlocked
- Live leaderboard sorted by score desc, submit time asc
- Certificate batch script (`scripts/generate-certificates.ts`) for score >= 180

## Assumptions
- Difficulty mapping in source question bank is positional: Q1-25 easy, Q26-50 medium, Q51-75 hard.
- "1 attempt per email" enforced for submitted attempts; voided attempts can restart.
- Local mode keeps data in-memory; Firebase mode persists in Firestore.

## Key Paths
- API app: `src/app.ts`
- Quiz engine: `src/quiz-engine.ts`
- Question parser: `src/question-bank.ts`
- Server bootstrap: `src/server.ts`
- Frontend: `public/index.html`, `public/app.js`, `public/styles.css`
- Tests: `test/*.test.ts`
