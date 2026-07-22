import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const requireFromWeb = createRequire(path.resolve(process.cwd(), "apps/web/package.json"));
const JSZip = requireFromWeb("jszip");

const formats = {
  docx: { nativeExtension: "odt", exportFilter: "Office Open XML Text" },
  xlsx: { nativeExtension: "ods", exportFilter: "Calc MS Excel 2007 XML" },
  pptx: { nativeExtension: "odp", exportFilter: "Impress MS PowerPoint 2007 XML" },
};

export function resolveLibreOfficeBinary(explicit = "") {
  const candidates = [
    explicit,
    process.env.LIBREOFFICE_PATH,
    path.join(os.homedir(), "Applications/LibreOffice.app/Contents/MacOS/soffice"),
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ].filter(Boolean);
  return candidates[0];
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function injectOdfMarker(contentXml, extension, marker) {
  const escaped = escapeXml(marker);
  if (extension === "docx") {
    assert(contentXml.includes("</office:text>"), "ODT content.xml has no office:text root");
    return contentXml.replace("</office:text>", `<text:p>${escaped}</text:p></office:text>`);
  }
  if (extension === "xlsx") {
    assert(contentXml.includes("</table:table>"), "ODS content.xml has no table");
    const row = `<table:table-row><table:table-cell office:value-type="string"><text:p>${escaped}</text:p></table:table-cell></table:table-row>`;
    return contentXml.replace("</table:table>", `${row}</table:table>`);
  }
  if (extension === "pptx") {
    if (contentXml.includes("</draw:text-box>")) {
      return contentXml.replace("</draw:text-box>", `<text:p>${escaped}</text:p></draw:text-box>`);
    }
    assert(contentXml.includes("</draw:custom-shape>"), "ODP content.xml has no editable text box or custom shape");
    return contentXml.replace("</draw:custom-shape>", `<text:p>${escaped}</text:p></draw:custom-shape>`);
  }
  throw new Error(`unsupported LibreOffice round-trip extension: ${extension}`);
}

export async function libreOfficeVersion(sofficePath) {
  const { stdout } = await execFileAsync(sofficePath, ["--version"], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

export async function libreOfficeRoundTripBytes({ bytes, extension, filename, marker, sofficePath }) {
  const format = formats[extension];
  assert(format, `unsupported LibreOffice extension: ${extension}`);
  assert(marker, "LibreOffice marker is required");
  const root = await mkdtemp(path.join(os.tmpdir(), "internshannon-libreoffice-"));
  const inputDir = path.join(root, "input");
  const nativeDir = path.join(root, "native");
  const outputDir = path.join(root, "output");
  const profileDir = path.join(root, "profile");
  await Promise.all([inputDir, nativeDir, outputDir, profileDir].map((directory) => mkdir(directory, { recursive: true })));
  try {
    const basename = path.basename(filename, path.extname(filename));
    const input = path.join(inputDir, `${basename}.${extension}`);
    await writeFile(input, bytes);
    await convertWithLibreOffice({ sofficePath, profileDir, input, outputDir: nativeDir, target: format.nativeExtension });
    const nativePath = path.join(nativeDir, `${basename}.${format.nativeExtension}`);
    const archive = await JSZip.loadAsync(await readFile(nativePath));
    const contentEntry = archive.file("content.xml");
    assert(contentEntry, `${format.nativeExtension} does not contain content.xml`);
    const contentXml = await contentEntry.async("string");
    const modifiedXml = injectOdfMarker(contentXml, extension, marker);
    archive.file("content.xml", modifiedXml);
    await writeFile(nativePath, await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
    await convertWithLibreOffice({
      sofficePath,
      profileDir,
      input: nativePath,
      outputDir,
      target: `${extension}:${format.exportFilter}`,
    });
    const outputPath = path.join(outputDir, `${basename}.${extension}`);
    const output = await readFile(outputPath);
    assert(output.length > 0, "LibreOffice produced an empty OOXML file");
    return {
      bytes: output,
      marker,
      nativeExtension: format.nativeExtension,
      inputBytes: bytes.length,
      outputBytes: output.length,
      markerInNativeDocument: modifiedXml.includes(marker),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function convertWithLibreOffice({ sofficePath, profileDir, input, outputDir, target }) {
  const profileUrl = pathToFileURL(profileDir).href;
  const { stdout, stderr } = await execFileAsync(
    sofficePath,
    [
      "--headless",
      "--nologo",
      "--nodefault",
      "--nofirststartwizard",
      `-env:UserInstallation=${profileUrl}`,
      "--convert-to",
      target,
      "--outdir",
      outputDir,
      input,
    ],
    { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const output = `${stdout}\n${stderr}`;
  assert(!/Error:/i.test(output), `LibreOffice conversion failed: ${output.trim()}`);
}
