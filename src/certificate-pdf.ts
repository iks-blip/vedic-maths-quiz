export interface CertificatePdfResult {
  ok: boolean;
  buffer?: Buffer;
  error?: string;
}

export async function generateCertificatePdf(html: string): Promise<CertificatePdfResult> {
  try {
    const puppeteer = await import("puppeteer");
    const initialWidthPx = 1400;
    const initialHeightPx = 1100;
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(15_000);
      await page.setViewport({ width: initialWidthPx, height: initialHeightPx, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".certificate-canvas");

      const canvasEl = await page.$(".certificate-canvas");
      if (!canvasEl) {
        return { ok: false, error: "certificate_canvas_not_found" };
      }
      const box = await canvasEl.boundingBox();
      if (!box) {
        return { ok: false, error: "certificate_canvas_bounds_unavailable" };
      }

      const screenshot = await canvasEl.screenshot({ type: "png" });
      const pngBase64 = Buffer.from(screenshot).toString("base64");
      const pageWidthPx = Math.ceil(box.width);
      const pageHeightPx = Math.ceil(box.height);

      const pdfPage = await browser.newPage();
      pdfPage.setDefaultNavigationTimeout(15_000);
      await pdfPage.setViewport({ width: pageWidthPx, height: pageHeightPx, deviceScaleFactor: 2 });
      await pdfPage.setContent(
        `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${pageWidthPx}px ${pageHeightPx}px; margin: 0; }
    html, body { margin: 0; padding: 0; width: ${pageWidthPx}px; height: ${pageHeightPx}px; overflow: hidden; background: #fff; }
    img { display: block; width: ${pageWidthPx}px; height: ${pageHeightPx}px; }
  </style>
</head>
<body>
  <img alt="certificate" src="data:image/png;base64,${pngBase64}" />
</body>
</html>`,
        { waitUntil: "domcontentloaded" }
      );

      const pdfBuffer = await pdfPage.pdf({
        width: `${pageWidthPx}px`,
        height: `${pageHeightPx}px`,
        printBackground: true,
        preferCSSPageSize: true,
        pageRanges: "1",
        margin: { top: "0", right: "0", bottom: "0", left: "0" }
      });
      return { ok: true, buffer: Buffer.from(pdfBuffer) };
    } finally {
      await browser.close();
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "pdf_generation_failed"
    };
  }
}
