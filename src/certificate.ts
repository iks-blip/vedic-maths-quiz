import fs from "node:fs";
import path from "node:path";
import type { Attempt, CertificateType } from "./types.js";

function safe(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let cachedCss = "";
let cachedParticipationTemplate = "";
let cachedScoreTemplate = "";
let cachedSunLogoDataUri = "";
let cachedIksLogoDataUri = "";
let cachedShaileeSignatureDataUri = "";
let cachedShindeSignatureDataUri = "";
let cacheInitialized = false;
let cacheStamp = "";

function readPublicFile(relativePath: string): string {
  const absolutePath = path.resolve(process.cwd(), "public", relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

function readLogoDataUri(relativePath: string, mimeType: string): string {
  const absolutePath = path.resolve(process.cwd(), "public", relativePath);
  const file = fs.readFileSync(absolutePath);
  return `data:${mimeType};base64,${file.toString("base64")}`;
}

function getTemplateStamp(): string {
  const files = [
    path.resolve(process.cwd(), "public", "certificates", "certificate.css"),
    path.resolve(process.cwd(), "public", "certificates", "participation.html"),
    path.resolve(process.cwd(), "public", "certificates", "score.html"),
    path.resolve(process.cwd(), "public", "assets", "sun-logo.jpg"),
    path.resolve(process.cwd(), "public", "assets", "iks-logo.png"),
    path.resolve(process.cwd(), "public", "assets", "sig-shailee.png"),
    path.resolve(process.cwd(), "public", "assets", "sig-shinde.png")
  ];
  return files.map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join("|");
}

function ensureTemplateCache(): void {
  const nextStamp = getTemplateStamp();
  if (cacheInitialized && nextStamp === cacheStamp) {
    return;
  }
  cachedCss = readPublicFile(path.join("certificates", "certificate.css"));
  cachedParticipationTemplate = readPublicFile(path.join("certificates", "participation.html"));
  cachedScoreTemplate = readPublicFile(path.join("certificates", "score.html"));
  cachedSunLogoDataUri = readLogoDataUri(path.join("assets", "sun-logo.jpg"), "image/jpeg");
  cachedIksLogoDataUri = readLogoDataUri(path.join("assets", "iks-logo.png"), "image/png");
  cachedShaileeSignatureDataUri = readLogoDataUri(path.join("assets", "sig-shailee.png"), "image/png");
  cachedShindeSignatureDataUri = readLogoDataUri(path.join("assets", "sig-shinde.png"), "image/png");
  cacheInitialized = true;
  cacheStamp = nextStamp;
}

export function renderCertificateHtml(params: {
  attempt: Attempt;
  type: CertificateType;
  certificateId: string;
  issuedAt?: string;
}): string {
  ensureTemplateCache();

  const template = params.type === "score" ? cachedScoreTemplate : cachedParticipationTemplate;
  const issuedDate = new Date(params.issuedAt ?? Date.now()).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  const htmlWithInlinedAssets = template
    .replace('<link rel="stylesheet" href="certificate.css">', `<style>${cachedCss}</style>`)
    .replaceAll("../assets/sun-logo.jpg", cachedSunLogoDataUri)
    .replaceAll("../assets/iks-logo.png", cachedIksLogoDataUri)
    .replaceAll("../assets/sig-shailee.png", cachedShaileeSignatureDataUri)
    .replaceAll("../assets/sig-shinde.png", cachedShindeSignatureDataUri);

  return htmlWithInlinedAssets
    .replaceAll("{{name}}", safe(params.attempt.name))
    .replaceAll("{{certificateId}}", safe(params.certificateId))
    .replaceAll("{{issuedDate}}", safe(issuedDate))
    .replaceAll("{{score}}", safe(String(params.attempt.score)));
}
