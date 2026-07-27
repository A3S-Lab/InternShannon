#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_CODE_SDK_VERSION = '6.1.0';
export const EXPECTED_ACL_VERSION = '0.3.0';

const DEFAULT_RESOURCES_DIR = 'src-tauri/target/release/bundle/macos/internShannon.app/Contents/Resources';
const CODE_PACKAGE = '@a3s-lab/code';
const NATIVE_PACKAGE_PREFIX = '@a3s-lab/code-';

function parseArgs(argv) {
    const args = { dir: DEFAULT_RESOURCES_DIR, json: false };
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--dir') {
            args.dir = argv[index + 1];
            index += 1;
        } else if (token === '--json') {
            args.json = true;
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
            'Usage: node scripts/verify-sdk-runtime.mjs [--dir <path>] [--json]',
            '',
            `Asserts that a packaged app carries ${CODE_PACKAGE}@${EXPECTED_CODE_SDK_VERSION}`,
            `and that its native binding was compiled with a3s-acl@${EXPECTED_ACL_VERSION}.`,
        ].join('\n'),
    );
}

function isFile(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function packageRelativePath(packageName) {
    return path.join(...packageName.split('/'), 'package.json');
}

function candidateNodeModulesDirs(resourcesDir) {
    const resolved = path.resolve(resourcesDir);
    return [
        path.join(resolved, 'node_modules'),
        path.join(resolved, 'sidecar', 'node_modules'),
        path.basename(resolved) === 'sidecar' ? path.join(resolved, 'node_modules') : null,
    ].filter((value, index, values) => value && values.indexOf(value) === index);
}

function findPackage(nodeModulesDirs, packageName) {
    const relativePath = packageRelativePath(packageName);
    for (const nodeModulesDir of nodeModulesDirs) {
        const packageJsonPath = path.join(nodeModulesDir, relativePath);
        if (isFile(packageJsonPath)) {
            return {
                nodeModulesDir,
                packageDir: path.dirname(packageJsonPath),
                packageJsonPath,
                manifest: readJson(packageJsonPath),
            };
        }
    }
    return null;
}

function nativePackageNames(codeManifest) {
    return Object.keys(codeManifest.optionalDependencies ?? {}).filter(name => name.startsWith(NATIVE_PACKAGE_PREFIX));
}

function findNativeBinding(nodeModulesDirs, codeManifest) {
    const candidates = [];
    for (const packageName of nativePackageNames(codeManifest)) {
        const found = findPackage(nodeModulesDirs, packageName);
        if (!found) continue;
        const binaryPath = path.join(found.packageDir, found.manifest.main ?? '');
        if (!isFile(binaryPath)) continue;
        candidates.push({ packageName, binaryPath, ...found });
    }
    return candidates;
}

function binaryContains(binaryPath, marker) {
    return fs.readFileSync(binaryPath).includes(Buffer.from(marker));
}

export function inspectBundledSdk(resourcesDir) {
    const nodeModulesDirs = candidateNodeModulesDirs(resourcesDir);
    const codePackage = findPackage(nodeModulesDirs, CODE_PACKAGE);
    const issues = [];

    if (!codePackage) {
        return {
            resourcesDir: path.resolve(resourcesDir),
            expected: { codeSdk: EXPECTED_CODE_SDK_VERSION, acl: EXPECTED_ACL_VERSION },
            issues: [`missing packaged ${CODE_PACKAGE}/package.json`],
            ok: false,
        };
    }

    if (codePackage.manifest.version !== EXPECTED_CODE_SDK_VERSION) {
        issues.push(
            `expected ${CODE_PACKAGE}@${EXPECTED_CODE_SDK_VERSION}, found ${codePackage.manifest.version ?? 'unknown'}`,
        );
    }

    const bindings = findNativeBinding(nodeModulesDirs, codePackage.manifest);
    if (bindings.length === 0) {
        issues.push('missing packaged @a3s-lab/code native platform binding');
    }

    const aclMarker = `a3s-acl-${EXPECTED_ACL_VERSION}/src/lexer.rs`;
    const bindingReports = bindings.map(binding => {
        const versionMatches = binding.manifest.version === EXPECTED_CODE_SDK_VERSION;
        const aclMatches = binaryContains(binding.binaryPath, aclMarker);
        if (!versionMatches) {
            issues.push(
                `expected ${binding.packageName}@${EXPECTED_CODE_SDK_VERSION}, found ${binding.manifest.version ?? 'unknown'}`,
            );
        }
        if (!aclMatches) {
            issues.push(`${binding.packageName} native binary does not contain compiled dependency marker ${aclMarker}`);
        }
        return {
            packageName: binding.packageName,
            packageVersion: binding.manifest.version,
            packageJsonPath: binding.packageJsonPath,
            binaryPath: binding.binaryPath,
            aclMarker,
            aclVersion: aclMatches ? EXPECTED_ACL_VERSION : null,
        };
    });

    return {
        resourcesDir: path.resolve(resourcesDir),
        expected: { codeSdk: EXPECTED_CODE_SDK_VERSION, acl: EXPECTED_ACL_VERSION },
        codePackage: {
            name: CODE_PACKAGE,
            version: codePackage.manifest.version,
            packageJsonPath: codePackage.packageJsonPath,
        },
        nativeBindings: bindingReports,
        issues,
        ok: issues.length === 0,
    };
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        return;
    }

    const report = inspectBundledSdk(args.dir);
    if (args.json) {
        console.log(JSON.stringify(report, null, 2));
    } else if (report.ok) {
        console.log(`Packaged SDK OK: ${CODE_PACKAGE}@${report.codePackage.version}`);
        for (const binding of report.nativeBindings) {
            console.log(
                `Native binding OK: ${binding.packageName}@${binding.packageVersion}, compiled a3s-acl@${binding.aclVersion}`,
            );
            console.log(`Native binary: ${binding.binaryPath}`);
        }
    } else {
        console.error('Packaged SDK validation failed:');
        for (const issue of report.issues) {
            console.error(`- ${issue}`);
        }
    }

    if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
