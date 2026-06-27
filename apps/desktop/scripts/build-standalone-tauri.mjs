#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(DESKTOP_DIR, '..', '..');
const API_ENTRYPOINT = path.join(REPO_ROOT, 'apps', 'api', 'dist', 'main.js');
const TAURI_CONFIG_PATH = path.join(DESKTOP_DIR, 'src-tauri', 'tauri.conf.json');

function usage() {
    console.log(`Usage: node scripts/build-standalone-tauri.mjs [options] [tauri args]
       node scripts/build-standalone-tauri.mjs [options] -- [tauri args]

Builds Tauri with standalone sidecar resources, verifies the bundled runtime,
then restores src-tauri/resources/sidecar and src-tauri/resources/node back to
lightweight source-state resources.

Options:
  --release   Build with the default release Tauri config instead of the fast
              app-only verification config.
  --resources-dir <path>
              Validate and smoke-test this Tauri Resources directory. Relative
              paths resolve from apps/desktop.
  --skip-verify
              Skip post-build sidecar resource validation.
  --skip-smoke
              Skip the standalone sidecar smoke test.
  --node-platform <darwin|linux|win>
              Stage this Node.js runtime platform instead of inferring it from
              --target or the host.
  --node-arch <x64|arm64>
              Stage this Node.js runtime architecture instead of inferring it
              from --target or the host.
  --help      Show this help message.

Examples:
  pnpm tauri:bundle -- --target aarch64-apple-darwin --bundles dmg
  pnpm tauri:bundle -- --target x86_64-pc-windows-msvc --bundles nsis --skip-smoke
`);
}

function parseArgs(argv) {
    const options = {
        help: false,
        release: false,
        resourcesDir: process.env.INTERNSHANNON_BUNDLE_RESOURCES_DIR,
        verify: process.env.INTERNSHANNON_BUNDLE_SKIP_VERIFY !== 'true',
        smoke: process.env.INTERNSHANNON_BUNDLE_SKIP_SMOKE !== 'true',
        nodePlatform: process.env.INTERNSHANNON_NODE_PLATFORM,
        nodeArch: process.env.INTERNSHANNON_NODE_ARCH,
        tauriArgs: [],
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--') {
            options.tauriArgs.push(...argv.slice(index + 1));
            break;
        }
        if (token === '--help' || token === '-h') {
            options.help = true;
            continue;
        }
        if (token === '--release') {
            options.release = true;
            continue;
        }
        if (token === '--resources-dir' || token === '--verify-dir') {
            options.resourcesDir = requiredValue(argv, ++index, token);
            continue;
        }
        if (token.startsWith('--resources-dir=')) {
            options.resourcesDir = token.slice('--resources-dir='.length);
            continue;
        }
        if (token.startsWith('--verify-dir=')) {
            options.resourcesDir = token.slice('--verify-dir='.length);
            continue;
        }
        if (token === '--skip-verify' || token === '--no-verify') {
            options.verify = false;
            continue;
        }
        if (token === '--skip-smoke' || token === '--no-smoke') {
            options.smoke = false;
            continue;
        }
        if (token === '--node-platform') {
            options.nodePlatform = requiredValue(argv, ++index, token);
            continue;
        }
        if (token.startsWith('--node-platform=')) {
            options.nodePlatform = token.slice('--node-platform='.length);
            continue;
        }
        if (token === '--node-arch') {
            options.nodeArch = requiredValue(argv, ++index, token);
            continue;
        }
        if (token.startsWith('--node-arch=')) {
            options.nodeArch = token.slice('--node-arch='.length);
            continue;
        }

        options.tauriArgs.push(token);
    }

    return options;
}

function requiredValue(argv, index, token) {
    const value = argv[index];
    if (!value || value.startsWith('--')) {
        throw new Error(`${token} requires a value`);
    }
    return value;
}

function commandForLocalBin(name) {
    const executableName = process.platform === 'win32' ? `${name}.cmd` : name;
    const localPath = path.join(DESKTOP_DIR, 'node_modules', '.bin', executableName);
    return fs.existsSync(localPath) ? localPath : executableName;
}

function needsShell(command) {
    return process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(command);
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: DESKTOP_DIR,
        env: { ...process.env, ...options.env },
        shell: needsShell(command),
        stdio: 'inherit',
    });

    if (result.error) {
        throw new Error(`Failed to execute ${command}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        const error = new Error(`${command} exited with ${result.status}`);
        error.status = result.status;
        throw error;
    }
}

function normalizeNodePlatform(value) {
    if (!value) return undefined;
    if (value === 'darwin' || value === 'macos' || value === 'osx') return 'darwin';
    if (value === 'linux') return 'linux';
    if (value === 'win' || value === 'win32' || value === 'windows') return 'win';
    throw new Error(`Unsupported Node runtime platform: ${value}`);
}

function normalizeNodeArch(value) {
    if (!value) return undefined;
    if (value === 'x64' || value === 'amd64' || value === 'x86_64') return 'x64';
    if (value === 'arm64' || value === 'aarch64') return 'arm64';
    throw new Error(`Unsupported Node runtime arch: ${value}`);
}

function hostRuntimeTarget() {
    return {
        platform: normalizeNodePlatform(process.platform),
        arch: normalizeNodeArch(process.arch),
    };
}

function extractTauriArgValue(tauriArgs, name) {
    let target;
    for (let index = 0; index < tauriArgs.length; index += 1) {
        const token = tauriArgs[index];
        if (token === name) {
            target = tauriArgs[index + 1];
            break;
        }
        if (token.startsWith(`${name}=`)) {
            target = token.slice(name.length + 1);
            break;
        }
    }
    return target;
}

function inferNodeRuntimeTarget(tauriArgs, options = {}) {
    const target = extractTauriArgValue(tauriArgs, '--target');
    const explicitPlatform = normalizeNodePlatform(options.nodePlatform);
    const explicitArch = normalizeNodeArch(options.nodeArch);

    if (explicitPlatform || explicitArch) {
        return {
            platform: explicitPlatform,
            arch: explicitArch,
        };
    }

    if (!target) {
        return {};
    }

    if (target.includes('apple-darwin')) {
        return {
            platform: 'darwin',
            arch: target.startsWith('aarch64-') ? 'arm64' : 'x64',
        };
    }
    if (target.includes('windows')) {
        return {
            platform: 'win',
            arch: target.startsWith('aarch64-') ? 'arm64' : 'x64',
        };
    }
    if (target.includes('linux')) {
        return {
            platform: 'linux',
            arch: target.startsWith('aarch64-') ? 'arm64' : 'x64',
        };
    }

    return {};
}

function stageNodeRuntime(tauriArgs, options) {
    const target = inferNodeRuntimeTarget(tauriArgs, options);
    const args = ['scripts/stage-node-runtime.mjs'];
    if (target.platform) {
        args.push('--platform', target.platform);
    }
    if (target.arch) {
        args.push('--arch', target.arch);
    }
    run(process.execPath, args);
}

function resetSourceNodeRuntime() {
    run(process.execPath, ['scripts/stage-node-runtime.mjs', '--clean']);
}

function findPythonRuntimeExecutable(rootDir) {
    const candidates = [
        path.join(rootDir, 'bin', 'python3'),
        path.join(rootDir, 'bin', 'python'),
        path.join(rootDir, 'install', 'bin', 'python3'),
        path.join(rootDir, 'install', 'bin', 'python'),
        path.join(rootDir, 'python.exe'),
        path.join(rootDir, 'install', 'python.exe'),
    ];
    return candidates.find(candidate => fs.existsSync(candidate));
}

function findClawSentryLauncher(rootDir) {
    const candidates = [
        path.join(rootDir, 'bin', 'clawsentry'),
        path.join(rootDir, 'bin', 'clawsentry.cmd'),
        path.join(rootDir, 'bin', 'clawsentry.exe'),
    ];
    return candidates.find(candidate => fs.existsSync(candidate));
}

function hasClawSentryRuntime() {
    const resourcesDir = path.join(DESKTOP_DIR, 'src-tauri', 'resources');
    const pythonDir = path.join(resourcesDir, 'python');
    const clawsentryDir = path.join(resourcesDir, 'clawsentry');
    return (
        Boolean(findPythonRuntimeExecutable(pythonDir)) &&
        Boolean(findClawSentryLauncher(clawsentryDir)) &&
        fs.existsSync(path.join(clawsentryDir, 'entrypoints', 'clawsentry.py')) &&
        fs.existsSync(path.join(clawsentryDir, 'site-packages'))
    );
}

function findCachedPythonRuntime() {
    const cacheRoot = path.join(DESKTOP_DIR, '.cache', 'python-runtime');
    const queue = [cacheRoot];
    const matches = [];
    while (queue.length > 0) {
        const current = queue.shift();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (!entry.isDirectory()) continue;
            if (findPythonRuntimeExecutable(entryPath)) {
                matches.push(entryPath);
                continue;
            }
            queue.push(entryPath);
        }
    }
    return matches.sort().at(-1);
}

function stageClawSentryRuntimeIfNeeded() {
    if (hasClawSentryRuntime()) return;

    const args = ['scripts/stage-clawsentry-runtime.mjs'];
    const bundledPython = findPythonRuntimeExecutable(path.join(DESKTOP_DIR, 'src-tauri', 'resources', 'python'));
    if (!bundledPython || !fs.existsSync(bundledPython)) {
        const runtimeDir = findCachedPythonRuntime();
        if (!runtimeDir) {
            throw new Error(
                'ClawSentry runtime is missing and no cached Python runtime was found under apps/desktop/.cache/python-runtime.',
            );
        }
        args.push('--python-runtime-dir', path.relative(DESKTOP_DIR, runtimeDir));
    }
    run(process.execPath, args);
}

function resetSourceSidecarToDistOnly() {
    if (!fs.existsSync(API_ENTRYPOINT)) {
        console.warn(
            'build-standalone-tauri: skipping dist-only sidecar reset because apps/sidecar/dist/main.js is missing.',
        );
        return;
    }
    run(process.execPath, ['scripts/stage-sidecar-resources.mjs', '--dist-only']);
}

function readProductName() {
    try {
        const config = JSON.parse(fs.readFileSync(TAURI_CONFIG_PATH, 'utf8'));
        return config.productName ?? '书小安';
    } catch {
        return '书小安';
    }
}

function hasSidecarEntrypoint(resourcesDir) {
    return (
        fs.existsSync(path.join(resourcesDir, 'main.js')) ||
        fs.existsSync(path.join(resourcesDir, 'sidecar', 'main.js'))
    );
}

function releaseDirForTauriArgs(tauriArgs) {
    const target = extractTauriArgValue(tauriArgs, '--target');
    if (target) {
        return path.join(DESKTOP_DIR, 'src-tauri', 'target', target, 'release');
    }
    return path.join(DESKTOP_DIR, 'src-tauri', 'target', 'release');
}

function collectBundledResourcesDirs(rootDir, maxDepth = 6) {
    const matches = [];
    const queue = [{ dir: rootDir, depth: 0 }];
    while (queue.length > 0) {
        const { dir, depth } = queue.shift();
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }

        if (path.basename(dir) === 'Resources' && hasSidecarEntrypoint(dir)) {
            matches.push(dir);
            continue;
        }

        if (depth >= maxDepth) {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
    }
    return matches;
}

function candidateResourcesDirs(tauriArgs, options) {
    const candidates = [];
    if (options.resourcesDir) {
        candidates.push(path.resolve(DESKTOP_DIR, options.resourcesDir));
    }

    const releaseDir = releaseDirForTauriArgs(tauriArgs);
    const productName = readProductName();
    candidates.push(path.join(releaseDir, 'bundle', 'macos', `${productName}.app`, 'Contents', 'Resources'));
    candidates.push(...collectBundledResourcesDirs(path.join(releaseDir, 'bundle')));

    // For installer formats that cannot be inspected cheaply (NSIS/MSI/deb/rpm),
    // validate the staged resources before they are reset.
    candidates.push(path.join(DESKTOP_DIR, 'src-tauri', 'resources'));

    return [...new Set(candidates)];
}

function resolveResourcesDir(tauriArgs, options) {
    for (const candidate of candidateResourcesDirs(tauriArgs, options)) {
        if (hasSidecarEntrypoint(candidate)) {
            if (!options.resourcesDir && candidate.endsWith(path.join('src-tauri', 'resources'))) {
                console.warn(
                    'build-standalone-tauri: using staged src-tauri/resources for validation because no inspectable bundled Resources directory was found.',
                );
            }
            return candidate;
        }
    }

    throw new Error(
        [
            'Could not locate a Tauri Resources directory containing sidecar/main.js.',
            'Pass --resources-dir <path> for this bundle format, or use --skip-verify --skip-smoke.',
        ].join(' '),
    );
}

function resolvedRuntimeTarget(tauriArgs, options) {
    const inferred = inferNodeRuntimeTarget(tauriArgs, options);
    const host = hostRuntimeTarget();
    return {
        platform: inferred.platform ?? host.platform,
        arch: inferred.arch ?? host.arch,
    };
}

function canSmokeRuntime(runtimeTarget) {
    const host = hostRuntimeTarget();
    return runtimeTarget.platform === host.platform && runtimeTarget.arch === host.arch;
}

function formatRuntimeTarget(target) {
    return `${target.platform}-${target.arch}`;
}

function main() {
    let exitCode = 0;
    let shouldResetSourceSidecar = false;
    let shouldResetSourceNodeRuntime = false;
    try {
        const options = parseArgs(process.argv.slice(2));
        if (options.help) {
            usage();
            return;
        }

        const { tauriArgs } = options;
        const baseTauriArgs = options.release
            ? ['build']
            : ['build', '--config', 'src-tauri/tauri.test.conf.json', '--no-sign'];
        const runtimeTarget = resolvedRuntimeTarget(tauriArgs, options);

        shouldResetSourceSidecar = true;
        shouldResetSourceNodeRuntime = true;
        stageNodeRuntime(tauriArgs, options);
        stageClawSentryRuntimeIfNeeded();
        run(commandForLocalBin('tauri'), [...baseTauriArgs, ...tauriArgs], {
            env: { INTERNSHANNON_SIDECAR_STAGE_MODE: 'standalone' },
        });

        if (options.verify || options.smoke) {
            const resourcesDir = resolveResourcesDir(tauriArgs, options);
            if (options.verify) {
                run(process.execPath, [
                    'scripts/verify-sidecar-resources.mjs',
                    '--dir',
                    resourcesDir,
                    '--require-standalone',
                ]);
            }
            if (options.smoke) {
                if (canSmokeRuntime(runtimeTarget)) {
                    run(process.execPath, ['scripts/smoke-standalone-sidecar.mjs', '--dir', resourcesDir]);
                } else {
                    console.warn(
                        [
                            'build-standalone-tauri: skipping standalone sidecar smoke because',
                            `the staged runtime ${formatRuntimeTarget(runtimeTarget)} cannot run on`,
                            `the host ${formatRuntimeTarget(hostRuntimeTarget())}.`,
                        ].join(' '),
                    );
                }
            }
        }
    } catch (error) {
        exitCode = Number.isInteger(error.status) ? error.status : 1;
        console.error(`build-standalone-tauri: ${error.message}`);
    } finally {
        if (shouldResetSourceSidecar) {
            try {
                resetSourceSidecarToDistOnly();
            } catch (error) {
                console.error(`build-standalone-tauri: ${error.message}`);
                if (exitCode === 0) {
                    exitCode = Number.isInteger(error.status) ? error.status : 1;
                }
            }
        }
        if (shouldResetSourceNodeRuntime) {
            try {
                resetSourceNodeRuntime();
            } catch (error) {
                console.error(`build-standalone-tauri: ${error.message}`);
                if (exitCode === 0) {
                    exitCode = Number.isInteger(error.status) ? error.status : 1;
                }
            }
        }
    }

    process.exit(exitCode);
}

main();
