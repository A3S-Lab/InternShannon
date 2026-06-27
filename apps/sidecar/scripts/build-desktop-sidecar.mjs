import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformFile } from '@swc/core';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(appRoot, 'src');
const distRoot = path.join(appRoot, 'dist');
const tsconfigPath = path.join(appRoot, 'tsconfig.build.json');

const tsconfig = JSON.parse(await fs.readFile(tsconfigPath, 'utf8'));
const include = tsconfig.include ?? [];
const exclude = tsconfig.exclude ?? [];

await fs.rm(distRoot, { recursive: true, force: true });

const files = [...await collectSourceFiles(include)]
    .filter(file => !isExcluded(file))
    .sort();

for (const file of files) {
    const relative = path.relative(srcRoot, file);
    const outFile = path.join(distRoot, relative).replace(/\.ts$/, '.js');
    const result = await transformFile(file, {
        filename: file,
        configFile: path.join(appRoot, '.swcrc'),
        sourceMaps: true,
    });
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, result.code, 'utf8');
    if (result.map) {
        await fs.writeFile(`${outFile}.map`, result.map, 'utf8');
    }
}

console.log(`desktop sidecar build ok (${files.length} files)`);

async function collectSourceFiles(patterns) {
    const result = new Set();
    for (const pattern of patterns) {
        if (pattern.endsWith('/**/*.ts') || pattern.endsWith('/**/*.d.ts')) {
            const dir = pattern.slice(0, pattern.indexOf('/**/'));
            await walk(path.join(appRoot, dir), file => {
                if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
                    result.add(file);
                }
            });
            continue;
        }
        if (pattern.includes('**')) {
            throw new Error(`Unsupported include glob: ${pattern}`);
        }
        const absolute = path.join(appRoot, pattern);
        if (absolute.endsWith('.ts') && !absolute.endsWith('.d.ts') && await exists(absolute)) {
            result.add(absolute);
        }
    }
    return result;
}

async function walk(dir, visit) {
    if (!await exists(dir)) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await walk(absolute, visit);
        } else if (entry.isFile()) {
            visit(absolute);
        }
    }
}

function isExcluded(file) {
    const relative = path.relative(appRoot, file).replaceAll(path.sep, '/');
    return exclude.some(pattern => matchesExcludePattern(relative, pattern));
}

function matchesExcludePattern(relative, pattern) {
    if (pattern === 'node_modules' || pattern === 'dist' || pattern === 'test' || pattern === 'scripts') {
        return relative === pattern || relative.startsWith(`${pattern}/`);
    }
    if (pattern === '**/*spec.ts') {
        return relative.endsWith('spec.ts');
    }
    if (pattern === 'builtin-assets') {
        return relative === pattern || relative.startsWith('builtin-assets/');
    }
    return relative === pattern;
}

async function copyDirIfExists(from, to) {
    if (!await exists(from)) return;
    await fs.cp(from, to, { recursive: true });
}

async function exists(target) {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}
