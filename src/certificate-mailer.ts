import type { CertificateType } from "./types.js";
import { generateCertificatePdf } from "./certificate-pdf.js";

export interface CertificateMailInput {
  to: string;
  name: string;
  certificateType: CertificateType;
  score: number;
  certificateId: string;
  certificateHtml: string;
}

export interface CertificateMailResult {
  status: "sent" | "failed";
  error?: string;
}

export async function sendCertificateEmail(input: CertificateMailInput): Promise<CertificateMailResult> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !user || !pass || !from) {
    return { status: "failed", error: "smtp_not_configured" };
  }

  try {
    const pdf = await generateCertificatePdf(input.certificateHtml);
    if (!pdf.ok || !pdf.buffer) {
      return { status: "failed", error: `pdf_generation_failed:${pdf.error ?? "unknown"}` };
    }

    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });

    const subject =
      input.certificateType === "score"
        ? "Your Vedic Maths Score Certificate"
        : "Your Vedic Maths Participation Certificate";

    await transporter.sendMail({
      from,
      to: input.to,
      subject,
      html: `
        <p>Hello ${input.name},</p>
        <p>Your certificate is attached as a PDF.</p>
        <p>Certificate ID: <strong>${input.certificateId}</strong></p>
        ${input.certificateType === "score" ? `<p>Your Score: <strong>${input.score}</strong></p>` : ""}
      `,
      attachments: [
        {
          filename: `certificate-${input.certificateId}.pdf`,
          content: pdf.buffer,
          contentType: "application/pdf"
        }
      ]
    });
    return { status: "sent" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "email_send_failed" };
  }
}
