import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const port = Number(process.env.KB_REAL_OCR_PORT || 39871);
const host = "127.0.0.1";

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    const { stdout } = await execFileAsync("tesseract", ["--version"]);
    return json(response, 200, { status: "ok", engine: stdout.split("\n")[0] });
  }
  if (request.method !== "POST" || request.url !== "/ocr") return json(response, 404, { error: "not_found" });

  try {
    const body = JSON.parse(await readBody(request));
    const bytes = Buffer.from(String(body.file || ""), "base64");
    if (bytes.length === 0) return json(response, 400, { error: "empty_file" });
    const result = await recognize(bytes, String(body.filename || "image.png"), String(body.mimeType || "image/png"));
    console.log(`[real-ocr-provider] filename=${body.filename || "image.png"} pages=${result.pages.length} chars=${result.text.length}`);
    return json(response, 200, result);
  } catch (error) {
    console.error(`[real-ocr-provider] failed ${error instanceof Error ? error.message : String(error)}`);
    return json(response, 500, { error: "ocr_failed" });
  }
});

async function recognize(bytes, filename, mimeType) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "internshannon-real-ocr-"));
  try {
    const extension = mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf") ? ".pdf" : path.extname(filename) || ".png";
    const inputPath = path.join(directory, `input${extension}`);
    await writeFile(inputPath, bytes);
    let images = [inputPath];
    if (extension === ".pdf") {
      const pattern = path.join(directory, "page-%03d.png");
      await execFileAsync("magick", ["-density", "180", inputPath, pattern], { maxBuffer: 16 * 1024 * 1024 });
      images = [];
      for (let index = 0; ; index += 1) {
        const pagePath = path.join(directory, `page-${String(index).padStart(3, "0")}.png`);
        try {
          await readFile(pagePath);
          images.push(pagePath);
        } catch {
          break;
        }
      }
    }
    const pages = [];
    for (const [pageIndex, image] of images.entries()) {
      const { stdout } = await execFileAsync("tesseract", [image, "stdout", "-l", "chi_sim+eng", "--psm", "6"], { maxBuffer: 16 * 1024 * 1024 });
      pages.push({ pageIndex, text: stdout.trim() });
    }
    const text = pages.map((page) => page.text).filter(Boolean).join("\n\f\n");
    return { text, pages, blocks: [], metadata: { engine: "tesseract", languages: ["chi_sim", "eng"] } };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) {
        reject(new Error("request_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

server.listen(port, host, () => console.log(`[real-ocr-provider] listening=http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
