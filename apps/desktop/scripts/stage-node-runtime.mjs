#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(SCRIPT_DIR, '..');
const CACHE_DIR = path.join(DESKTOP_DIR, '.cache', 'node-runtime');
const NODE_RESOURCE_DIR = path.join(DESKTOP_DIR, 'src-tauri', 'resources', 'node');
const DEFAULT_NODE_MAJOR = '22';
const DEFAULT_NODE_DIST_BASE_URL = 'https://nodejs.org/dist';

function usage() {
    console.log(`Usage: node scripts/stage-node-runtime.mjs [--clean] [--version <v22.x.x>] [--platform <darwin|linux|win>] [--arch <x64|arm64>]

Downloads and stages an official Node.js runtime into src-tauri/resources/node
so Tauri can bundle it into the desktop app. Downloaded archives are cached in
apps/desktop/.cache/node-runtime.
`);
}

function parseArgs(argv) {
    const args = {
        clean: false,
        version: process.env.INTERNSHANNON_NODE_VERSION,
        major: process.env.INTERNSHANNON_NODE_MAJOR ?? DEFAULT_NODE_MAJOR,
        platform: process.env.INTERNSHANNON_NODE_PLATFORM,
        arch: process.env.INTERNSHANNON_NODE_ARCH,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--clean') {
            args.clean = true;
        } else if (token === '--version') {
            args.version = argv[index + 1];
            index += 1;
        } else if (token === '--major') {
            args.major = argv[index + 1];
            index += 1;
        } else if (token === '--platform') {
            args.platform = argv[index + 1];
            index += 1;
        } else if (token === '--arch') {
            args.arch = argv[index + 1];
            index += 1;
        } else if (token === '--help' || token === '-h') {
            args.help = true;
        } else {
            throw new Error(`Unknown argument: ${token}`);
        }
    }

    return args;
}

function fail(message) {
    console.error(`stage-node-runtime: ${message}`);
    process.exit(1);
}

function normalizeVersion(version) {
    if (!version) {
        return undefined;
    }
    const value = version.trim();
    return value.startsWith('v') ? value : `v${value}`;
}

function normalizePlatform(value) {
    const platform = value ?? process.platform;
    if (platform === 'darwin' || platform === 'macos' || platform === 'osx') {
        return 'darwin';
    }
    if (platform === 'linux') {
        return 'linux';
    }
    if (platform === 'win' || platform === 'win32' || platform === 'windows') {
        return 'win';
    }
    throw new Error(`Unsupported Node runtime platform: ${platform}`);
}

function normalizeArch(value) {
    const arch = value ?? process.arch;
    if (arch === 'x64' || arch === 'amd64' || arch === 'x86_64') {
        return 'x64';
    }
    if (arch === 'arm64' || arch === 'aarch64') {
        return 'arm64';
    }
    throw new Error(`Unsupported Node runtime arch: ${arch}`);
}

function archiveExtension(platform) {
    return platform === 'win' ? '.zip' : '.tar.xz';
}

function archiveName(version, platform, arch) {
    return `node-${version}-${platform}-${arch}${archiveExtension(platform)}`;
}

function nodeExecutablePath(rootDir, platform) {
    return platform === 'win' ? path.join(rootDir, 'node.exe') : path.join(rootDir, 'bin', 'node');
}

function requestBuffer(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        const request = client.get(url, response => {
            if (
                response.statusCode &&
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
            ) {
                if (redirects >= 5) {
                    reject(new Error(`Too many redirects for ${url}`));
                    return;
                }
                const nextUrl = new URL(response.headers.location, url).toString();
                response.resume();
                resolve(requestBuffer(nextUrl, redirects + 1));
                return;
            }
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode ?? 'unknown'} for ${url}`));
                return;
            }

            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
        });
        request.on('error', reject);
    });
}

async function fetchJson(url) {
    const buffer = await requestBuffer(url);
    return JSON.parse(buffer.toString('utf8'));
}

async function fetchText(url) {
    const buffer = await requestBuffer(url);
    return buffer.toString('utf8');
}

async function resolveLatestVersion(baseUrl, major) {
    const releases = await fetchJson(`${baseUrl}/index.json`);
    const prefix = `v${major}.`;
    const release = releases.find(item => item.version?.startsWith(prefix));
    if (!release) {
        throw new Error(`Could not find a Node.js ${major}.x release in ${baseUrl}/index.json`);
    }
    return release.version;
}

async function expectedSha256(baseUrl, version, filename) {
    const sums = await fetchText(`${baseUrl}/${version}/SHASUMS256.txt`);
    for (const line of sums.split(/\r?\n/)) {
        const [sha, name] = line.trim().split(/\s+/);
        if (name === filename) {
            return sha;
        }
    }
    throw new Error(`Could not find ${filename} in ${version}/SHASUMS256.txt`);
}

function sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

async function ensureArchive(baseUrl, version, platform, arch) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const filename = archiveName(version, platform, arch);
    const archivePath = path.join(CACHE_DIR, filename);
    const expectedSha = await expectedSha256(baseUrl, version, filename);

    if (fs.existsSync(archivePath) && sha256File(archivePath) === expectedSha) {
        return { filename, archivePath, expectedSha, downloaded: false };
    }

    const tmpPath = `${archivePath}.tmp`;
    fs.rmSync(tmpPath, { force: true });
    console.log(`Downloading Node.js runtime: ${baseUrl}/${version}/${filename}`);
    const archive = await requestBuffer(`${baseUrl}/${version}/${filename}`);
    fs.writeFileSync(tmpPath, archive);
    const actualSha = sha256File(tmpPath);
    if (actualSha !== expectedSha) {
        fs.rmSync(tmpPath, { force: true });
        throw new Error(`Checksum mismatch for ${filename}: expected ${expectedSha}, got ${actualSha}`);
    }
    fs.renameSync(tmpPath, archivePath);
    return { filename, archivePath, expectedSha, downloaded: true };
}

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: DESKTOP_DIR,
        stdio: 'inherit',
    });
    if (result.error) {
        throw new Error(`Failed to execute ${command}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${command} exited with ${result.status}`);
    }
}

function moveExtractedRuntime(extractedDir, cacheRuntimeDir) {
    try {
        fs.renameSync(extractedDir, cacheRuntimeDir);
    } catch (error) {
        if (error?.code !== 'EXDEV') {
            throw error;
        }

        fs.cpSync(extractedDir, cacheRuntimeDir, { recursive: true, verbatimSymlinks: true });
    }
}

function extractArchive(archivePath, version, platform, arch) {
    const cacheRuntimeDir = path.join(CACHE_DIR, `${version}-${platform}-${arch}`);
    const executable = nodeExecutablePath(cacheRuntimeDir, platform);
    if (fs.existsSync(executable)) {
        return cacheRuntimeDir;
    }

    const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'internshannon-node-runtime.'));
    try {
        if (platform === 'win') {
            run('tar', ['-xf', archivePath, '-C', extractRoot]);
        } else {
            run('tar', ['-xJf', archivePath, '-C', extractRoot]);
        }

        const extractedName = `node-${version}-${platform}-${arch}`;
        const extractedDir = path.join(extractRoot, extractedName);
        if (!fs.existsSync(nodeExecutablePath(extractedDir, platform))) {
            throw new Error(`Extracted archive did not contain ${nodeExecutablePath(extractedDir, platform)}`);
        }

        fs.rmSync(cacheRuntimeDir, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(cacheRuntimeDir), { recursive: true });
        moveExtractedRuntime(extractedDir, cacheRuntimeDir);
        return cacheRuntimeDir;
    } finally {
        fs.rmSync(extractRoot, { recursive: true, force: true });
    }
}

function resetResourceDir() {
    fs.rmSync(NODE_RESOURCE_DIR, { recursive: true, force: true });
    fs.mkdirSync(NODE_RESOURCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(NODE_RESOURCE_DIR, '.gitkeep'), '');
}

function stageRuntime(runtimeDir, metadata) {
    resetResourceDir();
    fs.rmSync(path.join(NODE_RESOURCE_DIR, '.gitkeep'), { force: true });
    fs.cpSync(runtimeDir, NODE_RESOURCE_DIR, { recursive: true });

    const executable = nodeExecutablePath(NODE_RESOURCE_DIR, metadata.platform);
    if (!fs.existsSync(executable)) {
        throw new Error(`Staged Node executable is missing: ${executable}`);
    }
    if (metadata.platform !== 'win') {
        fs.chmodSync(executable, 0o755);
    }
    fs.writeFileSync(
        path.join(NODE_RESOURCE_DIR, 'node-runtime-manifest.json'),
        `${JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                destination: path.relative(DESKTOP_DIR, NODE_RESOURCE_DIR),
                nodeExecutable: path.relative(NODE_RESOURCE_DIR, executable),
                ...metadata,
            },
            null,
            2,
        )}\n`,
    );
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        usage();
        return;
    }
    if (args.clean) {
        resetResourceDir();
        console.log(`Reset bundled Node runtime resources: ${path.relative(DESKTOP_DIR, NODE_RESOURCE_DIR)}`);
        return;
    }

    const baseUrl = (process.env.INTERNSHANNON_NODE_DIST_BASE_URL ?? DEFAULT_NODE_DIST_BASE_URL).replace(/\/$/, '');
    const platform = normalizePlatform(args.platform);
    const arch = normalizeArch(args.arch);
    const version = normalizeVersion(args.version) ?? (await resolveLatestVersion(baseUrl, args.major));
    const { filename, archivePath, expectedSha, downloaded } = await ensureArchive(baseUrl, version, platform, arch);
    const runtimeDir = extractArchive(archivePath, version, platform, arch);
    stageRuntime(runtimeDir, {
        version,
        major: args.major,
        platform,
        arch,
        source: `${baseUrl}/${version}/${filename}`,
        archive: path.relative(DESKTOP_DIR, archivePath),
        sha256: expectedSha,
        downloaded,
    });

    console.log(
        `Staged Node.js runtime ${version} (${platform}-${arch}) -> ${path.relative(DESKTOP_DIR, NODE_RESOURCE_DIR)}`,
    );
}

main().catch(error => {
    fail(error.message);
});
