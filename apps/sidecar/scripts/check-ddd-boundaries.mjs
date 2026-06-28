import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sidecarRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(sidecarRoot, 'src');
const layers = new Set(['domain', 'application', 'infrastructure', 'presentation']);
const frameworkPresentationImports = [
    '@nestjs/common',
    '@nestjs/swagger',
    'class-transformer',
    'class-validator',
];

const forbiddenDirs = [
    'desktop-runtime',
    'infrastructure',
    'modules/desktop-mode',
    'modules/kernel/dto',
    'modules/loop/loops',
];

const violations = [];

function toPosix(value) {
    return value.split(path.sep).join('/');
}

function existsDir(relativeDir) {
    return fs.existsSync(path.join(srcRoot, relativeDir));
}

function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(absolute));
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
            files.push(absolute);
        }
    }
    return files;
}

function moduleLayer(relativeFile) {
    const parts = relativeFile.split('/');
    if (parts[0] !== 'modules') return null;
    const layerIndex = parts.findIndex(part => layers.has(part));
    if (layerIndex < 0) {
        return { context: parts.slice(1, -1).join('/'), layer: null };
    }
    return {
        context: parts.slice(1, layerIndex).join('/'),
        layer: parts[layerIndex],
    };
}

function localImportTarget(fromFile, specifier) {
    if (specifier.startsWith('@/')) {
        return specifier.slice(2);
    }
    if (!specifier.startsWith('.')) {
        return null;
    }
    const absolute = path.resolve(path.dirname(fromFile), specifier);
    if (!absolute.startsWith(`${srcRoot}${path.sep}`)) {
        return null;
    }
    return toPosix(path.relative(srcRoot, absolute));
}

function targetKind(relativeTarget) {
    if (relativeTarget.startsWith('runtime/')) return { kind: 'runtime', layer: 'runtime' };
    const module = moduleLayer(relativeTarget);
    if (module) return { kind: 'module', ...module };
    if (relativeTarget.startsWith('shared/')) return { kind: 'shared', layer: 'shared' };
    return { kind: 'other', layer: null };
}

function checkSharedPlacement(relativeFile) {
    if (relativeFile.startsWith('shared/application/') && path.posix.basename(relativeFile).endsWith('.dto.ts')) {
        violations.push(`${relativeFile}: shared application must not contain presentation DTOs`);
    }
}

function checkPlacement(relativeFile) {
    checkSharedPlacement(relativeFile);

    if (!relativeFile.startsWith('modules/')) return;

    const basename = path.posix.basename(relativeFile);
    if (basename.endsWith('.controller.ts') && !relativeFile.includes('/presentation/controllers/')) {
        violations.push(`${relativeFile}: controllers must live under presentation/controllers`);
    }
    if (basename.endsWith('.dto.ts') && !relativeFile.includes('/presentation/dto/')) {
        violations.push(`${relativeFile}: DTOs must live under presentation/dto`);
    }
    if (
        basename.endsWith('.repository.ts') &&
        !basename.endsWith('.repository.interface.ts') &&
        !relativeFile.includes('/infrastructure/')
    ) {
        violations.push(`${relativeFile}: repository implementations must live under infrastructure`);
    }
    if (basename.endsWith('.interceptor.ts') && !relativeFile.includes('/presentation/interceptors/')) {
        violations.push(`${relativeFile}: presentation interceptors must live under presentation/interceptors`);
    }
}

function checkFrameworkImport(relativeFile, specifier) {
    if (!relativeFile.startsWith('shared/domain/') && !relativeFile.startsWith('shared/application/')) {
        return;
    }

    const isFrameworkPresentationImport =
        specifier.startsWith('@nestjs/') || frameworkPresentationImports.includes(specifier);
    if (isFrameworkPresentationImport) {
        violations.push(`${relativeFile} -> ${specifier}: shared domain/application must stay framework-agnostic`);
    }
}

function checkImport(fromFile, relativeFile, specifier) {
    checkFrameworkImport(relativeFile, specifier);

    const relativeTarget = localImportTarget(fromFile, specifier);
    if (!relativeTarget) return;

    if (relativeFile.startsWith('shared/') && /^(modules|runtime)\//.test(relativeTarget)) {
        violations.push(`${relativeFile} -> ${specifier}: shared must not depend on modules or runtime`);
        return;
    }
    if (relativeFile.startsWith('shared/domain/') && /^shared\/(application|api|infrastructure)\//.test(relativeTarget)) {
        violations.push(`${relativeFile} -> ${specifier}: shared domain must not depend on shared application/api/infrastructure`);
        return;
    }
    if (relativeFile.startsWith('shared/application/') && /^shared\/(api|infrastructure)\//.test(relativeTarget)) {
        violations.push(`${relativeFile} -> ${specifier}: shared application must not depend on shared api/infrastructure`);
        return;
    }

    const source = moduleLayer(relativeFile);
    if (!source?.layer) return;

    const target = targetKind(relativeTarget);
    const targetLayer = target.layer;
    if (!targetLayer) return;

    const from = `${relativeFile} -> ${specifier}`;
    if (source.layer === 'domain' && ['application', 'infrastructure', 'presentation', 'runtime'].includes(targetLayer)) {
        violations.push(`${from}: domain must not depend on ${targetLayer}`);
    }
    if (source.layer === 'application' && ['infrastructure', 'presentation', 'runtime'].includes(targetLayer)) {
        violations.push(`${from}: application must not depend on ${targetLayer}`);
    }
    if (
        source.layer === 'application' &&
        target.kind === 'module' &&
        target.layer === 'application' &&
        source.context !== target.context
    ) {
        violations.push(`${from}: application must not depend on another bounded context's application layer`);
    }
    if (source.layer === 'infrastructure' && ['application', 'presentation', 'runtime'].includes(targetLayer)) {
        violations.push(`${from}: infrastructure must not depend on ${targetLayer}`);
    }
    if (
        source.layer === 'infrastructure' &&
        target.kind === 'module' &&
        target.layer === 'infrastructure' &&
        source.context !== target.context
    ) {
        violations.push(`${from}: infrastructure must not depend on another bounded context's infrastructure layer`);
    }
    if (source.layer === 'presentation' && ['infrastructure', 'runtime'].includes(targetLayer)) {
        violations.push(`${from}: presentation must not depend on ${targetLayer}`);
    }
    if (
        source.layer === 'presentation' &&
        target.kind === 'module' &&
        target.layer === 'presentation' &&
        source.context !== target.context
    ) {
        violations.push(`${from}: presentation must not depend on another bounded context's presentation layer`);
    }
}

for (const relativeDir of forbiddenDirs) {
    if (existsDir(relativeDir)) {
        violations.push(`${relativeDir}: forbidden legacy/mis-layered directory still exists`);
    }
}

const sourceFiles = walk(srcRoot);
const importRegex = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gs;

for (const file of sourceFiles) {
    const relativeFile = toPosix(path.relative(srcRoot, file));
    checkPlacement(relativeFile);

    if (relativeFile.endsWith('.spec.ts')) {
        continue;
    }

    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(importRegex)) {
        checkImport(file, relativeFile, match[1]);
    }
}

if (violations.length > 0) {
    console.error('DDD boundary check failed:');
    for (const violation of violations) {
        console.error(`- ${violation}`);
    }
    process.exit(1);
}

console.log('DDD boundary check passed');
