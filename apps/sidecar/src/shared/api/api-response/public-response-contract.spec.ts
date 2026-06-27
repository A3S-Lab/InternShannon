import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const statusCodeContractPattern = /\bstatusCode\b/;

function listFiles(dir: string, predicate: (file: string) => boolean): string[] {
    const entries = readdirSync(dir);
    return entries.flatMap(entry => {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            return listFiles(fullPath, predicate);
        }
        return predicate(fullPath) ? [fullPath] : [];
    });
}

describe('public API response contract', () => {
    const srcRoot = resolve(__dirname, '../../..');

    it('does not expose statusCode in public response DTOs or OpenAPI schemas', () => {
        const moduleResponseDtos = listFiles(join(srcRoot, 'modules'), file =>
            file.includes('/presentation/dto/response/') &&
            file.endsWith('.ts') &&
            !file.endsWith('.spec.ts'),
        );

        const publicContractFiles = [
            ...moduleResponseDtos,
            join(srcRoot, 'shared/api/api-response/api-response.dto.ts'),
            join(srcRoot, 'shared/api/openapi/openapi-decorators.ts'),
        ];

        const violations = publicContractFiles
            .filter(file => statusCodeContractPattern.test(readFileSync(file, 'utf8')))
            .map(file => relative(srcRoot, file));

        expect(violations).toEqual([]);
    });
});
