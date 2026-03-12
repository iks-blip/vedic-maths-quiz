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
- No default date lock is enforced now.
- Set these only at real launch time:
```bash
export EVENT_START_AT_IST="2026-03-14T00:00:00+05:30"
export EVENT_END_AT_IST="2026-03-14T12:00:00+05:30"
```

## Admin Panel
- URL: `/admin`
- Set token before starting server:
```bash
export ADMIN_TOKEN="replace-with-strong-token"
```
- Admin APIs require `Authorization: Bearer <token>`.
- Includes leaderboard view, submissions view, audit logs, disqualify action, and CSV export.

## SMTP for Certificates
Certificate emails require SMTP env vars:
```bash
export SMTP_HOST="smtp.your-provider.com"
export SMTP_PORT="587"
export SMTP_USER="your-smtp-username"
export SMTP_PASS="your-smtp-password"
export SMTP_FROM="Vedic Maths Quiz <no-reply@your-domain.com>"
```

If SMTP is missing/invalid:
- Certificate preview still works.
- Email status is saved as `failed` and visible in admin CSV (`certificate_status`, `certificate_error`).

## Anti-Cheat Controls
- IP-based request throttling on `/api/attempts/*` and `/api/admin/*`.
- Suspicious flags in admin submissions (tab switches, very-fast answers, disqualified).
- Admin disqualify endpoint:
```bash
POST /api/admin/attempts/:attemptId/disqualify
Authorization: Bearer <ADMIN_TOKEN>
```

## Event Controls
- Admin can set event state from `/admin`:
  - `active`: quiz operations enabled
  - `paused`: blocks new attempts and in-progress actions
  - `stopped`: blocks new attempts and in-progress actions
- APIs:
```bash
GET /api/event-state
GET /api/admin/event-state
POST /api/admin/event-state
Authorization: Bearer <ADMIN_TOKEN>
Body: { "status": "active|paused|stopped", "actor": "admin_name" }
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
