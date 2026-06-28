#!/usr/bin/env node

import fs from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';

const DEFAULT_RESOURCES_DIR = 'src-tauri/target/release/bundle/macos/internShannon.app/Contents/Resources';
const REQUIRED_FILES = ['main.js', 'intern-shannon-sidecar.module.js', 'shared/infrastructure/config/load-env.js'];
const BUILTIN_MODULES = new Set(
    builtinModules.flatMap(moduleName => [
        moduleName,
        moduleName.startsWith('node:') ? moduleName.slice('node:'.length) : `node:${moduleName}`,
    ]),
);

function parseArgs(argv) {
    const args = {
        dir: DEFAULT_RESOURCES_DIR,
        json: false,
        requireStandalone: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === '--dir') {
            args.dir = argv[i + 1];
            i += 1;
        } else if (token === '--json') {
            args.json = true;
        } else if (token === '--require-standalone') {
            args.requireStandalone = true;
        } else if (token === '--help' || token === '-h') {
            args.help = true;
        } else {
            throw new Error(`Unknown argument: ${token}`);
        }
    }

    return args;
}

function printHelp() {
    console.log(
        [
            'Usage: node scripts/verify-sidecar-resources.mjs [--dir <path>]',
            '       node scripts/verify-sidecar-resources.mjs [--dir <path>] [--json] [--require-standalone]',
            '',
            'Validates the bundled NestJS sidecar resources in a Tauri Resources directory.',
            '`--require-standalone` additionally fails if the staged sidecar still depends on external node_modules.',
        ].join('\n'),
    );
}

function exists(p) {
    return fs.existsSync(p);
}

function isSubpath(candidatePath, parentPath) {
    const relativePath = path.relative(parentPath, candidatePath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isFile(p) {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

function isDirectory(p) {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function findSidecarDir(startDir) {
    const resolved = path.resolve(startDir);
    if (isFile(path.join(resolved, 'main.js'))) {
        return resolved;
    }

    const nested = path.join(resolved, 'sidecar');
    if (isFile(path.join(nested, 'main.js'))) {
        return nested;
    }

    throw new Error(
        [
            `Could not find sidecar main.js under ${resolved}.`,
            'Build a fresh desktop app with `pnpm build`,',
            'or point `--dir` at `src-tauri/resources/sidecar`.',
        ].join(' '),
    );
}

function findResourcesDir(startDir, sidecarDir) {
    const resolved = path.resolve(startDir);
    if (isFile(path.join(resolved, 'main.js'))) {
        return path.basename(resolved) === 'sidecar' ? path.dirname(resolved) : resolved;
    }
    if (sidecarDir === path.join(resolved, 'sidecar')) {
        return resolved;
    }
    return sidecarDir;
}

function findBundledNode(resourcesDir) {
    const candidates = [path.join(resourcesDir, 'node', 'bin', 'node'), path.join(resourcesDir, 'node', 'node.exe')];
    return candidates.find(isFile);
}

function findBundledPython(resourcesDir) {
    const candidates = [
        path.join(resourcesDir, 'python', 'bin', 'python3'),
        path.join(resourcesDir, 'python', 'bin', 'python'),
        path.join(resourcesDir, 'python', 'install', 'bin', 'python3'),
        path.join(resourcesDir, 'python', 'install', 'bin', 'python'),
        path.join(resourcesDir, 'python', 'python.exe'),
        path.join(resourcesDir, 'python', 'install', 'python.exe'),
    ];
    return candidates.find(isFile);
}

function findClawSentryLauncher(resourcesDir) {
    const candidates = [
        path.join(resourcesDir, 'clawsentry', 'bin', 'clawsentry'),
        path.join(resourcesDir, 'clawsentry', 'bin', 'clawsentry.cmd'),
        path.join(resourcesDir, 'clawsentry', 'bin', 'clawsentry.exe'),
    ];
    return candidates.find(isFile);
}

function inspectClawSentryBundle(resourcesDir) {
    const python = findBundledPython(resourcesDir);
    const launcher = findClawSentryLauncher(resourcesDir);
    const entrypoint = path.join(resourcesDir, 'clawsentry', 'entrypoints', 'clawsentry.py');
    const sitePackages = path.join(resourcesDir, 'clawsentry', 'site-packages');
    const pythonRuntimeStats = collectFileStats(path.join(resourcesDir, 'python'));
    const clawsentryStats = collectFileStats(path.join(resourcesDir, 'clawsentry'));
    return {
        python,
        launcher,
        entrypoint: isFile(entrypoint) ? entrypoint : undefined,
        sitePackages: isDirectory(sitePackages) ? sitePackages : undefined,
        sitePackagesFiles: isDirectory(sitePackages) ? collectFileStats(sitePackages).files : 0,
        pythonRuntimeFiles: pythonRuntimeStats.files,
        pythonRuntimeBytes: pythonRuntimeStats.bytes,
        clawsentryFiles: clawsentryStats.files,
        clawsentryBytes: clawsentryStats.bytes,
    };
}

function walkFiles(dir) {
    const files = [];
    const queue = [dir];

    while (queue.length > 0) {
        const current = queue.shift();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const absolutePath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === 'builtin-assets') {
                    continue;
                }
                queue.push(absolutePath);
                continue;
            }
            if (entry.isFile()) {
                files.push(absolutePath);
            }
        }
    }

    return files;
}

function collectFileStats(dir, options = {}) {
    const skipDirs = options.skipDirs ?? new Set();
    const stats = {
        files: 0,
        bytes: 0,
    };
    const queue = [dir];

    while (queue.length > 0) {
        const current = queue.shift();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const absolutePath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name)) {
                    queue.push(absolutePath);
                }
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            stats.files += 1;
            stats.bytes += fs.statSync(absolutePath).size;
        }
    }

    return stats;
}

function collectSymlinkIssues(sidecarDir) {
    const issues = [];
    const queue = [sidecarDir];

    while (queue.length > 0) {
        const current = queue.shift();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const absolutePath = path.join(current, entry.name);
            const relativePath = path.relative(sidecarDir, absolutePath);
            if (entry.isSymbolicLink()) {
                const target = fs.readlinkSync(absolutePath);
                const resolvedTarget = path.resolve(path.dirname(absolutePath), target);
                if (path.isAbsolute(target)) {
                    issues.push(`absolute symlink: ${relativePath} -> ${target}`);
                    continue;
                }
                if (!isSubpath(resolvedTarget, sidecarDir)) {
                    issues.push(`symlink escapes sidecar: ${relativePath} -> ${target}`);
                    continue;
                }
                if (!exists(resolvedTarget)) {
                    issues.push(`broken symlink: ${relativePath} -> ${target}`);
                }
                continue;
            }
            if (entry.isDirectory()) {
                queue.push(absolutePath);
            }
        }
    }

    return issues;
}

function formatBytes(value) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let amount = value;
    let unitIndex = 0;
    while (amount >= 1024 && unitIndex < units.length - 1) {
        amount /= 1024;
        unitIndex += 1;
    }
    return `${amount.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function collectExternalRequires(sidecarDir, files) {
    const packages = new Set();
    const specifiers = new Set();
    const requirePattern = /require\(["']([^"']+)["']\)/g;

    for (const filePath of files) {
        if (!filePath.endsWith('.js')) {
            continue;
        }
        let content = '';
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch {
            continue;
        }
        for (const match of content.matchAll(requirePattern)) {
            const specifier = match[1];
            if (
                specifier.startsWith('.') ||
                specifier.startsWith('/') ||
                BUILTIN_MODULES.has(specifier) ||
                BUILTIN_MODULES.has(specifier.split('/')[0])
            ) {
                continue;
            }
            packages.add(specifier);
            specifiers.add(specifier);
        }
    }

    const nodeModulesDir = path.join(sidecarDir, 'node_modules');
    return {
        packages: [...packages].sort(),
        specifiers: [...specifiers].sort(),
        hasNodeModules: exists(nodeModulesDir),
    };
}

function missingExternalRequires(sidecarDir, specifiers) {
    const require = createRequire(path.join(sidecarDir, 'main.js'));
    const missing = [];
    for (const specifier of specifiers) {
        try {
            require.resolve(specifier, { paths: [sidecarDir] });
        } catch {
            missing.push(specifier);
        }
    }
    return missing;
}

function validateSidecarDir(sidecarDir, resourcesDir, requireStandalone) {
    const issues = [];
    const bundledNode = findBundledNode(resourcesDir);
    const clawsentryBundle = inspectClawSentryBundle(resourcesDir);
    for (const relativePath of REQUIRED_FILES) {
        const absolutePath = path.join(sidecarDir, relativePath);
        if (!isFile(absolutePath)) {
            issues.push(`missing required sidecar file: ${relativePath}`);
            continue;
        }
        if (fs.statSync(absolutePath).size === 0) {
            issues.push(`empty required sidecar file: ${relativePath}`);
        }
    }

    const files = walkFiles(sidecarDir);
    const bytes = files.reduce((total, filePath) => total + fs.statSync(filePath).size, 0);
    const externalRequires = collectExternalRequires(sidecarDir, files);
    const totalStats = collectFileStats(sidecarDir);
    const nodeModulesStats = externalRequires.hasNodeModules
        ? collectFileStats(path.join(sidecarDir, 'node_modules'))
        : { files: 0, bytes: 0 };
    const nodeRuntimeStats = bundledNode ? collectFileStats(path.join(resourcesDir, 'node')) : { files: 0, bytes: 0 };
    if (requireStandalone) {
        if (!bundledNode) {
            issues.push('missing bundled Node.js runtime: expected node/bin/node or node/node.exe in Resources.');
        }
        if (!clawsentryBundle.python) {
            issues.push(
                'missing bundled Python runtime for ClawSentry: expected python/bin/python3, python/install/bin/python3, or python/python.exe in Resources.',
            );
        }
        if (!clawsentryBundle.sitePackages || clawsentryBundle.sitePackagesFiles === 0) {
            issues.push('missing bundled ClawSentry site-packages: expected clawsentry/site-packages in Resources.');
        }
        if (!clawsentryBundle.entrypoint) {
            issues.push(
                'missing bundled ClawSentry Python entrypoint: expected clawsentry/entrypoints/clawsentry.py in Resources.',
            );
        }
        if (!clawsentryBundle.launcher) {
            issues.push(
                'missing bundled ClawSentry launcher: expected clawsentry/bin/clawsentry or clawsentry/bin/clawsentry.cmd in Resources.',
            );
        }
        if (exists(path.join(sidecarDir, 'node_modules', '.modules.yaml'))) {
            issues.push(
                'sidecar node_modules still contains .modules.yaml; remove pnpm install metadata before running workspace pnpm commands.',
            );
        }
        const symlinkIssues = collectSymlinkIssues(sidecarDir);
        if (symlinkIssues.length > 0) {
            issues.push(
                [
                    'sidecar contains non-portable symlinks:',
                    `${symlinkIssues.slice(0, 12).join(', ')}${symlinkIssues.length > 12 ? ', ...' : ''}`,
                ].join(' '),
            );
        }
    }

    if (requireStandalone && externalRequires.packages.length > 0 && !externalRequires.hasNodeModules) {
        issues.push(
            [
                'sidecar is not standalone: compiled JS contains external package requires',
                `(${externalRequires.packages.slice(0, 12).join(', ')}${externalRequires.packages.length > 12 ? ', ...' : ''})`,
                'but no bundled node_modules directory was found.',
            ].join(' '),
        );
    }
    if (requireStandalone && externalRequires.hasNodeModules) {
        const missing = missingExternalRequires(sidecarDir, externalRequires.specifiers);
        if (missing.length > 0) {
            issues.push(
                [
                    'sidecar node_modules is incomplete; unresolved external requires:',
                    `${missing.slice(0, 16).join(', ')}${missing.length > 16 ? ', ...' : ''}`,
                ].join(' '),
            );
        }
    }

    return {
        files: files.length,
        bytes,
        totalFiles: totalStats.files,
        totalBytes: totalStats.bytes,
        nodeModulesFiles: nodeModulesStats.files,
        nodeModulesBytes: nodeModulesStats.bytes,
        nodeRuntimeFiles: nodeRuntimeStats.files,
        nodeRuntimeBytes: nodeRuntimeStats.bytes,
        bundledNode,
        clawsentryBundle,
        externalRequires,
        issues,
    };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const sidecarDir = findSidecarDir(args.dir);
    const resourcesDir = findResourcesDir(args.dir, sidecarDir);
    const {
        files,
        bytes,
        totalFiles,
        totalBytes,
        nodeModulesFiles,
        nodeModulesBytes,
        nodeRuntimeFiles,
        nodeRuntimeBytes,
        bundledNode,
        clawsentryBundle,
        externalRequires,
        issues,
    } = validateSidecarDir(sidecarDir, resourcesDir, args.requireStandalone);
    const report = {
        resourcesDir,
        sidecarDir,
        entrypoint: path.join(sidecarDir, 'main.js'),
        files,
        bytes,
        totalFiles,
        totalBytes,
        nodeModulesFiles,
        nodeModulesBytes,
        nodeRuntimeFiles,
        nodeRuntimeBytes,
        bundledNode,
        clawsentryBundle,
        externalPackages: externalRequires.packages,
        hasNodeModules: externalRequires.hasNodeModules,
        hasBundledNode: Boolean(bundledNode),
        hasBundledClawSentry: Boolean(
            clawsentryBundle.python &&
                clawsentryBundle.sitePackages &&
                clawsentryBundle.sitePackagesFiles > 0 &&
                clawsentryBundle.entrypoint &&
                clawsentryBundle.launcher,
        ),
        standaloneRequired: args.requireStandalone,
        ok: issues.length === 0,
        issues,
    };

    if (args.json) {
        console.log(JSON.stringify(report, null, 2));
        if (!report.ok) {
            process.exitCode = 1;
        }
        return;
    }

    console.log(`Sidecar resource directory: ${sidecarDir}`);
    console.log(`Entrypoint: ${report.entrypoint}`);
    console.log(`JS resource files scanned: ${files}`);
    console.log(`JS resource bytes scanned: ${formatBytes(bytes)}`);
    console.log(`External package requires: ${externalRequires.packages.length}`);
    console.log(
        `Bundled node_modules: ${externalRequires.hasNodeModules ? `yes (${nodeModulesFiles} files, ${formatBytes(nodeModulesBytes)})` : 'no'}`,
    );
    console.log(
        `Bundled Node.js runtime: ${bundledNode ? `yes (${nodeRuntimeFiles} files, ${formatBytes(nodeRuntimeBytes)}, ${bundledNode})` : 'no'}`,
    );
    console.log(
        `Bundled ClawSentry runtime: ${
            report.hasBundledClawSentry
                ? `yes (${clawsentryBundle.clawsentryFiles} files, ${formatBytes(clawsentryBundle.clawsentryBytes)}, ${clawsentryBundle.launcher})`
                : 'no'
        }`,
    );
    console.log(
        `Bundled Python runtime: ${
            clawsentryBundle.python
                ? `yes (${clawsentryBundle.pythonRuntimeFiles} files, ${formatBytes(clawsentryBundle.pythonRuntimeBytes)}, ${clawsentryBundle.python})`
                : 'no'
        }`,
    );
    console.log(`Total sidecar files: ${totalFiles}`);
    console.log(`Total sidecar bytes: ${formatBytes(totalBytes)}`);

    if (issues.length > 0) {
        console.error('Sidecar resource validation failed:');
        for (const issue of issues) {
            console.error(`- ${issue}`);
        }
        process.exitCode = 1;
        return;
    }

    if (externalRequires.packages.length > 0 && !externalRequires.hasNodeModules) {
        console.log(
            'Standalone note: JS resources are staged, but release builds still need bundled node_modules or a single-file sidecar.',
        );
    }
    console.log('Sidecar resources OK.');
}

main();
