# Static HTML Certificate Requirements (AI Prompt Spec)

## Objective
Generate two **static** certificate templates:
1. Participation Certificate
2. Score Certificate

These templates are for fixed-layout rendering. No responsive behavior is needed.

## Output Files
- `public/certificates/participation.html`
- `public/certificates/score.html`
- optional shared stylesheet: `public/certificates/certificate.css`

## Mandatory Logo Usage
Use the existing local logos from assets:
- `public/assets/iks-logo.png`
- `public/assets/sun-logo.jpg`

Do not use remote/external logo URLs.

## Layout Rules (Strict)
- Fixed-size landscape certificate canvas.
- No responsive logic.
- No media queries.
- No fluid/flexible layout behavior.
- Keep all key elements in fixed positions for consistent print-like output.

## Dynamic Placeholders (Only These)
- `{{name}}`
- `{{certificateId}}`
- `{{issuedDate}}`
- `{{score}}` (score certificate only)

All other text/design must remain static.

## Design Constraints
- Place both logos in a visible header area on both certificate types.
- Keep dedicated fixed text areas for name and certificate metadata.
- Score certificate must include score field; participation certificate must not display score.
- Long names should remain within a predefined name box.
- Maintain high contrast for readability.

## Integration Expectation
Backend will inject only the placeholders above and render preview/email output from these static templates.
