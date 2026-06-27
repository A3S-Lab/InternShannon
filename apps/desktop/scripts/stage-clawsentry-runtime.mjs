#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(SCRIPT_DIR, '..');
const RESOURCES_DIR = path.join(DESKTOP_DIR, 'src-tauri', 'resources');
const PYTHON_RESOURCE_DIR = path.join(RESOURCES_DIR, 'python');
const CLAWSENTRY_RESOURCE_DIR = path.join(RESOURCES_DIR, 'clawsentry');
const SITE_PACKAGES_DIR = path.join(CLAWSENTRY_RESOURCE_DIR, 'site-packages');
const DEFAULT_PACKAGE_SPEC = 'clawsentry';
const DEFAULT_DISTRIBUTION_NAME = 'clawsentry';
const DEFAULT_CONSOLE_SCRIPT = 'clawsentry';

function usage() {
    console.log(`Usage: node scripts/stage-clawsentry-runtime.mjs [options]

Stages a bundled Python runtime plus ClawSentry site-packages into
src-tauri/resources so Tauri can package the managed security gateway.

Options:
  --clean                         Reset resources/python and resources/clawsentry
  --python-runtime-dir <dir>      Copy a relocatable Python runtime into resources/python
  --python-executable <path>      Python executable to use for pip and metadata inspection
  --package <specifier>           Pip package specifier to install (default: clawsentry)
  --distribution <name>           Python distribution name for metadata (default: clawsentry)
  --console-script <name>         Console script entry point (default: clawsentry)
  --no-index                      Pass --no-index to pip for offline wheelhouse installs
  --find-links <dir>              Pass --find-links to pip; may be repeated
  --extra-pip-arg <arg>           Extra pip argument; may be repeated
  --skip-install                  Reuse existing resources/clawsentry/site-packages
  --help                          Show this help

Environment:
  CLAWSENTRY_PYTHON_RUNTIME_DIR   Same as --python-runtime-dir
  CLAWSENTRY_PYTHON_EXECUTABLE    Same as --python-executable
  CLAWSENTRY_PACKAGE_SPEC         Same as --package
  CLAWSENTRY_DISTRIBUTION_NAME    Same as --distribution
`);
}

function parseArgs(argv) {
    const args = {
        clean: false,
        help: false,
        pythonRuntimeDir: process.env.CLAWSENTRY_PYTHON_RUNTIME_DIR,
        pythonExecutable: process.env.CLAWSENTRY_PYTHON_EXECUTABLE,
        packageSpec: process.env.CLAWSENTRY_PACKAGE_SPEC || DEFAULT_PACKAGE_SPEC,
        distributionName: process.env.CLAWSENTRY_DISTRIBUTION_NAME || DEFAULT_DISTRIBUTION_NAME,
        consoleScript: process.env.CLAWSENTRY_CONSOLE_SCRIPT || DEFAULT_CONSOLE_SCRIPT,
        noIndex: process.env.CLAWSENTRY_PIP_NO_INDEX === 'true',
        findLinks: process.env.CLAWSENTRY_PIP_FIND_LINKS ? [process.env.CLAWSENTRY_PIP_FIND_LINKS] : [],
        extraPipArgs: [],
        skipInstall: process.env.CLAWSENTRY_SKIP_INSTALL === 'true',
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--clean') {
            args.clean = true;
        } else if (token === '--help' || token === '-h') {
            args.help = true;
        } else if (token === '--python-runtime-dir') {
            args.pythonRuntimeDir = requiredValue(argv, ++index, token);
        } else if (token === '--python-executable') {
            args.pythonExecutable = requiredValue(argv, ++index, token);
        } else if (token === '--package') {
            args.packageSpec = requiredValue(argv, ++index, token);
        } else if (token === '--distribution') {
            args.distributionName = requiredValue(argv, ++index, token);
        } else if (token === '--console-script') {
            args.consoleScript = requiredValue(argv, ++index, token);
        } else if (token === '--no-index') {
            args.noIndex = true;
        } else if (token === '--find-links') {
            args.findLinks.push(requiredValue(argv, ++index, token));
        } else if (token === '--extra-pip-arg') {
            args.extraPipArgs.push(requiredValue(argv, ++index, token));
        } else if (token === '--skip-install') {
            args.skipInstall = true;
        } else {
            throw new Error(`Unknown argument: ${token}`);
        }
    }

    return args;
}

function requiredValue(argv, index, token) {
    const value = argv[index];
    if (!value || value.startsWith('--')) {
        throw new Error(`${token} requires a value`);
    }
    return value;
}

function fail(message) {
    console.error(`stage-clawsentry-runtime: ${message}`);
    process.exit(1);
}

function resetResourceDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.gitkeep'), '');
}

function resetAll() {
    resetResourceDir(PYTHON_RESOURCE_DIR);
    resetResourceDir(CLAWSENTRY_RESOURCE_DIR);
}

function stagePythonRuntime(runtimeDir) {
    const sourceDir = path.resolve(runtimeDir);
    if (!isDirectory(sourceDir)) {
        throw new Error(`Python runtime directory does not exist: ${sourceDir}`);
    }
    fs.rmSync(PYTHON_RESOURCE_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(PYTHON_RESOURCE_DIR), { recursive: true });
    fs.cpSync(sourceDir, PYTHON_RESOURCE_DIR, { recursive: true, verbatimSymlinks: true });
    const python = findPythonExecutable(PYTHON_RESOURCE_DIR);
    if (!python) {
        throw new Error(`Copied Python runtime does not contain a supported executable under ${PYTHON_RESOURCE_DIR}`);
    }
    if (process.platform !== 'win32') {
        fs.chmodSync(python, 0o755);
    }
    return python;
}

function findPythonExecutable(rootDir) {
    return findExistingFile([
        path.join(rootDir, 'bin', 'python3'),
        path.join(rootDir, 'bin', 'python'),
        path.join(rootDir, 'install', 'bin', 'python3'),
        path.join(rootDir, 'install', 'bin', 'python'),
        path.join(rootDir, 'python.exe'),
        path.join(rootDir, 'install', 'python.exe'),
    ]);
}

function resolvePythonExecutable(args) {
    if (args.pythonRuntimeDir) {
        return stagePythonRuntime(args.pythonRuntimeDir);
    }

    if (args.pythonExecutable) {
        const explicit = path.resolve(args.pythonExecutable);
        if (!isFile(explicit)) {
            throw new Error(`Python executable does not exist: ${explicit}`);
        }
        return explicit;
    }

    const bundled = findPythonExecutable(PYTHON_RESOURCE_DIR);
    if (bundled) return bundled;

    throw new Error(
        'No bundled Python runtime was found. Pass --python-runtime-dir or set CLAWSENTRY_PYTHON_RUNTIME_DIR.',
    );
}

function ensurePip(python) {
    const hasPip = spawnSync(python, ['-m', 'pip', '--version'], {
        cwd: DESKTOP_DIR,
        stdio: 'ignore',
        env: pythonEnv(),
    });
    if (hasPip.status === 0) return;

    run(python, ['-m', 'ensurepip', '--upgrade'], { env: pythonEnv() });
}

function installClawSentry(args, python) {
    fs.rmSync(CLAWSENTRY_RESOURCE_DIR, { recursive: true, force: true });
    fs.mkdirSync(SITE_PACKAGES_DIR, { recursive: true });
    ensurePip(python);

    const pipArgs = ['-m', 'pip', 'install', '--upgrade', '--target', SITE_PACKAGES_DIR];
    if (args.noIndex) {
        pipArgs.push('--no-index');
    }
    for (const findLinksDir of args.findLinks) {
        pipArgs.push('--find-links', path.resolve(findLinksDir));
    }
    pipArgs.push(...args.extraPipArgs, args.packageSpec);
    run(python, pipArgs, { env: pythonEnv() });
}

function resolveConsoleEntrypoint(args, python) {
    const code = `
import importlib.metadata as metadata
distribution_name = ${JSON.stringify(args.distributionName)}
console_script = ${JSON.stringify(args.consoleScript)}
dist = metadata.distribution(distribution_name)
matches = [
    ep for ep in dist.entry_points
    if ep.group == "console_scripts" and ep.name == console_script
]
if not matches:
    raise SystemExit(f"{distribution_name!r} does not expose console script {console_script!r}")
print(matches[0].value)
`.trim();
    return runCapture(python, ['-c', code], { env: pythonEnv({ PYTHONPATH: SITE_PACKAGES_DIR }) }).trim();
}

function writePythonEntrypoint(entrypointValue) {
    const normalized = entrypointValue.replace(/\s+\[.*\]$/, '').trim();
    const [moduleName, attrPath] = normalized.split(':');
    if (!moduleName || !attrPath) {
        throw new Error(`Unsupported console entry point value: ${entrypointValue}`);
    }

    const entrypointDir = path.join(CLAWSENTRY_RESOURCE_DIR, 'entrypoints');
    const entrypointPath = path.join(entrypointDir, 'clawsentry.py');
    fs.mkdirSync(entrypointDir, { recursive: true });
    fs.writeFileSync(
        entrypointPath,
        `import importlib
import os
import sys

MODULE_NAME = ${JSON.stringify(moduleName)}
ATTR_PATH = ${JSON.stringify(attrPath)}


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path = [
        item
        for item in sys.path
        if os.path.abspath(item or os.getcwd()) != script_dir
    ]
    target = importlib.import_module(MODULE_NAME)
    for part in ATTR_PATH.split("."):
        target = getattr(target, part)
    return target()


if __name__ == "__main__":
    raise SystemExit(main())
`,
    );
    return entrypointPath;
}

function writeLaunchers() {
    const binDir = path.join(CLAWSENTRY_RESOURCE_DIR, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const shPath = path.join(binDir, 'clawsentry');
    fs.writeFileSync(
        shPath,
        `#!/usr/bin/env sh
set -eu
SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
CLAWSENTRY_ROOT="$(dirname "$SCRIPT_DIR")"
RESOURCES_ROOT="$(dirname "$CLAWSENTRY_ROOT")"

if [ -x "$RESOURCES_ROOT/python/bin/python3" ]; then
  PYTHON="$RESOURCES_ROOT/python/bin/python3"
elif [ -x "$RESOURCES_ROOT/python/bin/python" ]; then
  PYTHON="$RESOURCES_ROOT/python/bin/python"
elif [ -x "$RESOURCES_ROOT/python/install/bin/python3" ]; then
  PYTHON="$RESOURCES_ROOT/python/install/bin/python3"
elif [ -x "$RESOURCES_ROOT/python/install/bin/python" ]; then
  PYTHON="$RESOURCES_ROOT/python/install/bin/python"
else
  echo "Bundled Python runtime was not found next to ClawSentry resources." >&2
  exit 127
fi

export PYTHONNOUSERSITE=1
export PYTHONDONTWRITEBYTECODE=1
if [ -n "\${PYTHONPATH:-}" ]; then
  export PYTHONPATH="$CLAWSENTRY_ROOT/site-packages:$PYTHONPATH"
else
  export PYTHONPATH="$CLAWSENTRY_ROOT/site-packages"
fi

exec "$PYTHON" "$CLAWSENTRY_ROOT/entrypoints/clawsentry.py" "$@"
`,
    );
    fs.chmodSync(shPath, 0o755);

    const cmdPath = path.join(binDir, 'clawsentry.cmd');
    fs.writeFileSync(
        cmdPath,
        `@echo off
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "CLAWSENTRY_ROOT=%%~fI"
for %%I in ("%CLAWSENTRY_ROOT%..") do set "RESOURCES_ROOT=%%~fI"

set "PYTHON=%RESOURCES_ROOT%\\python\\python.exe"
if not exist "%PYTHON%" set "PYTHON=%RESOURCES_ROOT%\\python\\install\\python.exe"
if not exist "%PYTHON%" (
  echo Bundled Python runtime was not found next to ClawSentry resources. 1>&2
  exit /b 127
)

set "PYTHONNOUSERSITE=1"
set "PYTHONDONTWRITEBYTECODE=1"
if defined PYTHONPATH (
  set "PYTHONPATH=%CLAWSENTRY_ROOT%\\site-packages;%PYTHONPATH%"
) else (
  set "PYTHONPATH=%CLAWSENTRY_ROOT%\\site-packages"
)

"%PYTHON%" "%CLAWSENTRY_ROOT%\\entrypoints\\clawsentry.py" %*
exit /b %ERRORLEVEL%
`,
    );

    return { shPath, cmdPath };
}

function writeManifest(metadata) {
    const manifest = {
        generatedAt: new Date().toISOString(),
        destination: path.relative(DESKTOP_DIR, CLAWSENTRY_RESOURCE_DIR),
        pythonDestination: path.relative(DESKTOP_DIR, PYTHON_RESOURCE_DIR),
        sitePackages: path.relative(CLAWSENTRY_RESOURCE_DIR, SITE_PACKAGES_DIR),
        ...metadata,
        clawsentryStats: collectFileStats(CLAWSENTRY_RESOURCE_DIR),
        pythonStats: collectFileStats(PYTHON_RESOURCE_DIR),
    };
    fs.writeFileSync(
        path.join(CLAWSENTRY_RESOURCE_DIR, 'clawsentry-runtime-manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
    );
}

function pythonEnv(extra = {}) {
    return {
        ...process.env,
        PYTHONNOUSERSITE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        ...extra,
    };
}

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: DESKTOP_DIR,
        stdio: 'inherit',
        env: { ...process.env, ...options.env },
    });
    if (result.error) {
        throw new Error(`Failed to execute ${command}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${command} exited with ${result.status}`);
    }
}

function runCapture(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: DESKTOP_DIR,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...options.env },
    });
    if (result.error) {
        throw new Error(`Failed to execute ${command}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${command} exited with ${result.status}: ${result.stderr.trim()}`);
    }
    return result.stdout;
}

function findExistingFile(candidates) {
    return candidates.find(isFile);
}

function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function isDirectory(dirPath) {
    try {
        return fs.statSync(dirPath).isDirectory();
    } catch {
        return false;
    }
}

function collectFileStats(dir) {
    if (!isDirectory(dir)) {
        return { files: 0, bytes: 0 };
    }
    let files = 0;
    let bytes = 0;
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(entryPath);
            } else if (entry.isFile()) {
                files += 1;
                bytes += fs.statSync(entryPath).size;
            }
        }
    }
    return { files, bytes };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        usage();
        return;
    }
    if (args.clean) {
        resetAll();
        console.log('Reset bundled ClawSentry and Python runtime resources.');
        return;
    }

    const python = resolvePythonExecutable(args);
    if (args.skipInstall) {
        if (!isDirectory(SITE_PACKAGES_DIR)) {
            throw new Error(`--skip-install requires existing site-packages: ${SITE_PACKAGES_DIR}`);
        }
    } else {
        installClawSentry(args, python);
    }

    const consoleEntrypoint = resolveConsoleEntrypoint(args, python);
    const entrypointPath = writePythonEntrypoint(consoleEntrypoint);
    const launchers = writeLaunchers();
    writeManifest({
        packageSpec: args.packageSpec,
        distributionName: args.distributionName,
        consoleScript: args.consoleScript,
        consoleEntrypoint,
        pythonExecutable: path.relative(RESOURCES_DIR, python),
        entrypoint: path.relative(CLAWSENTRY_RESOURCE_DIR, entrypointPath),
        launcher: path.relative(CLAWSENTRY_RESOURCE_DIR, launchers.shPath),
        windowsLauncher: path.relative(CLAWSENTRY_RESOURCE_DIR, launchers.cmdPath),
        pip: {
            noIndex: args.noIndex,
            findLinks: args.findLinks.map(item => path.resolve(item)),
            extraArgs: args.extraPipArgs,
            skipped: args.skipInstall,
        },
    });

    console.log(
        `Staged ClawSentry runtime -> ${path.relative(DESKTOP_DIR, CLAWSENTRY_RESOURCE_DIR)} using ${path.relative(
            DESKTOP_DIR,
            python,
        )}`,
    );
}

try {
    main();
} catch (error) {
    fail(error.message);
}
