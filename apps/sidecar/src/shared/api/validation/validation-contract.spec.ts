import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function listTypeScriptFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            return listTypeScriptFiles(fullPath);
        }
        return fullPath.endsWith('.ts') && !fullPath.endsWith('.spec.ts') ? [fullPath] : [];
    });
}

describe('validation mechanism contract', () => {
    const srcRoot = resolve(__dirname, '../../..');

    it('creates ValidationPipe only through the shared factory', () => {
        const allowedFile = join(srcRoot, 'shared/api/validation/validation.pipe.ts');
        const violations = listTypeScriptFiles(srcRoot)
            .filter(file => file !== allowedFile)
            .filter(file => /new\s+ValidationPipe\s*\(/.test(readFileSync(file, 'utf8')))
            .map(file => relative(srcRoot, file));

        expect(violations).toEqual([]);
    });
});
