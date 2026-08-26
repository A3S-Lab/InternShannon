import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sidecarRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(sidecarRoot, "../..");
const productionRoots = ["apps/sidecar/src", "apps/web/src", "apps/desktop/src-tauri/src"];
const productionExtensions = new Set([".js", ".mjs", ".rs", ".ts", ".tsx"]);
const forbiddenPatterns = [
    ["host compaction service", /\bContextCompactionService\b/g],
    ["host summary generator", /\bContextSummaryGenerator\b/g],
    ["host summary validator", /\bContextSummaryValidator\b/g],
    ["host context projection service", /\bKernelContextProjectionService\b/g],
    ["hidden context checkpoint", /\bcontext[_-]?checkpoint\b/gi],
    ["custom compact request protocol", /\bcontext[_-]?compact[_-]?(?:request|status|cancel)\b/gi],
    ["custom compaction lifecycle protocol", /\bcontext[_-]?compaction[_-]?(?:acknowledged|started|progress)\b/gi],
];
const violations = [];

function toPosix(value) {
    return value.split(path.sep).join("/");
}

function isProductionSource(file) {
    const name = path.basename(file);
    return productionExtensions.has(path.extname(name)) && !/\.(?:spec|test)\.[^.]+$/i.test(name);
}

function walk(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(target));
        } else if (entry.isFile() && isProductionSource(target)) {
            files.push(target);
        }
    }
    return files;
}

function relativePath(file) {
    return toPosix(path.relative(repositoryRoot, file));
}

function scanForbiddenArchitecture(file, content) {
    const relative = relativePath(file);
    for (const [label, pattern] of forbiddenPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(content) || pattern.test(relative)) {
            violations.push(`${relative}: ${label} is not allowed in production code`);
        }
    }
    if (content.includes("check-sdk-compaction-architecture")) {
        violations.push(`${relative}: production code must not import or invoke the CI architecture gate`);
    }
}

function readProductionFile(relative) {
    const file = path.join(repositoryRoot, relative);
    if (!fs.existsSync(file)) {
        violations.push(`${relative}: required architecture contract file is missing`);
        return "";
    }
    return fs.readFileSync(file, "utf8");
}

function checkSdkEngineContract(productionFiles) {
    const expectedFactory = "apps/sidecar/src/modules/kernel/application/kernel-session-runtime-factory.service.ts";
    const factory = readProductionFile(expectedFactory);
    if (!/from ['"]@a3s-lab\/code['"]/.test(factory)) {
        violations.push(`${expectedFactory}: SDK runtime must come from @a3s-lab/code`);
    }
    if (!/const sessionOptions:\s*SessionOptions\s*=\s*\{/.test(factory)) {
        violations.push(`${expectedFactory}: A3S SessionOptions construction is missing`);
    }
    if (!/autoCompact:\s*finalOverrides\.autoCompact\s*\?\?\s*true/.test(factory)) {
        violations.push(`${expectedFactory}: A3S autoCompact default/override contract is missing`);
    }

    const sessionOptionOwners = productionFiles
        .filter((file) => {
            const content = fs.readFileSync(file, "utf8");
            return /const\s+sessionOptions:\s*SessionOptions\s*=\s*\{/.test(content) && /autoCompact\s*:/.test(content);
        })
        .map(relativePath);
    if (sessionOptionOwners.length !== 1 || sessionOptionOwners[0] !== expectedFactory) {
        violations.push(
            `A3S autoCompact SessionOptions must have one production owner (${expectedFactory}); found=${sessionOptionOwners.join(", ") || "none"}`,
        );
    }
}

function checkSdkHistoryContract() {
    const relative = "apps/sidecar/src/modules/kernel/application/kernel-message-runner.service.ts";
    const source = readProductionFile(relative);
    const methodStart = source.indexOf("private async resolveRuntimeHistory");
    const methodEnd = methodStart < 0 ? -1 : source.indexOf("\n    private ", methodStart + 1);
    if (methodStart < 0 || methodEnd < 0) {
        violations.push(`${relative}: resolveRuntimeHistory architecture boundary is missing`);
        return;
    }

    const method = source.slice(methodStart, methodEnd);
    const historyGuard = method.search(
        /if\s*\(\s*input\.activeSession\.session\.history\(\)\.length\s*>\s*0\s*\)\s*return\s*\[\s*\]\s*;/,
    );
    const persistedHistoryRead = method.indexOf("this.conversationLog.listRuntimeHistory");
    if (historyGuard < 0) {
        violations.push(`${relative}: restored SDK history must suppress persisted transcript bootstrap`);
    }
    if (persistedHistoryRead < 0 || (historyGuard >= 0 && persistedHistoryRead < historyGuard)) {
        violations.push(`${relative}: persisted transcript may only be read after the SDK history guard`);
    }
}

const productionFiles = productionRoots.flatMap((relative) => walk(path.join(repositoryRoot, relative)));
for (const file of productionFiles) {
    scanForbiddenArchitecture(file, fs.readFileSync(file, "utf8"));
}
checkSdkEngineContract(productionFiles);
checkSdkHistoryContract();

if (violations.length > 0) {
    console.error("Single SDK compaction architecture check failed:");
    for (const violation of violations) {
        console.error(`- ${violation}`);
    }
    process.exit(1);
}

console.log(
    `Single SDK compaction architecture check passed: productionFiles=${productionFiles.length}, engine=a3s-autoCompact, customProtocols=0, hiddenCheckpoints=0`,
);
