import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const routeDecoratorPattern = /^\s*@(Get|Post|Put|Patch|Delete|All|Head|Options|Sse)\(/;
const sseRouteDecoratorPattern = /^\s*@Sse\(/;
const standardResponsePattern = /@Api(Ok|Created|Paginated|NoContent|Standard|Raw)(OneOf)?Response\(/;
const directSwaggerResponsePattern = /@ApiResponse\(/;
const directSwaggerResponseImportPattern =
    /import\s*\{[\s\S]*?\b(ApiOperation|ApiResponse|ApiOkResponse|ApiCreatedResponse|ApiNoContentResponse|ApiBadRequestResponse|ApiUnauthorizedResponse|ApiForbiddenResponse|ApiNotFoundResponse|ApiConflictResponse|ApiInternalServerErrorResponse)\b[\s\S]*?\}\s*from\s*['"]@nestjs\/swagger['"]/;
const operationPattern = /@ApiOperation\(/;
const chinesePattern = /[\u4e00-\u9fff]/;

function listControllerFiles(dir: string): string[] {
    const entries = readdirSync(dir);
    return entries.flatMap(entry => {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            return listControllerFiles(fullPath);
        }
        return fullPath.endsWith('controller.ts') ? [fullPath] : [];
    });
}

function getDecoratorBlock(lines: string[], routeLineIndex: number): string {
    const block: string[] = [];
    for (let index = routeLineIndex; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^\s*(async\s+)?[a-zA-Z0-9_]+\s*\(/.test(line)) {
            break;
        }
        block.push(line);
    }
    return block.join('\n');
}

describe('OpenAPI controller contract', () => {
    const srcRoot = resolve(__dirname, '../../..');
    const controllerFiles = listControllerFiles(srcRoot);

    it('uses /api/v1 as the only documented REST API prefix', () => {
        const mainSource = readFileSync(join(srcRoot, 'main.ts'), 'utf8');

        expect(mainSource).toContain("app.setGlobalPrefix('api/v1'");
        expect(mainSource).not.toContain('apiVersioningUrlRewriteMiddleware');
        expect(mainSource).not.toMatch(/app\.setGlobalPrefix\(['"]api['"]/);
        expect(mainSource).not.toContain("addServer('/api'");
        expect(mainSource).not.toContain('Legacy unversioned API');
    });

    it('uses shared OpenAPI response decorators for documented controllers', () => {
        const violations: string[] = [];

        for (const file of controllerFiles) {
            const source = readFileSync(file, 'utf8');
            if (source.includes('@ApiExcludeController()')) continue;

            const lines = source.split('\n');
            lines.forEach((line, index) => {
                if (!routeDecoratorPattern.test(line)) return;

                const block = getDecoratorBlock(lines, index);
                if (/@ApiExcludeEndpoint\(\)/.test(block)) return;
                if (!standardResponsePattern.test(block)) {
                    violations.push(`${relative(srcRoot, file)}:${index + 1}`);
                }
            });
        }

        expect(violations).toEqual([]);
    });

    it('does not use raw Swagger operation or response decorators in controllers', () => {
        const violations = controllerFiles
            .filter(file => {
                const source = readFileSync(file, 'utf8');
                if (source.includes('@ApiExcludeController()')) return false;
                return (
                    operationPattern.test(source) ||
                    directSwaggerResponsePattern.test(source) ||
                    directSwaggerResponseImportPattern.test(source)
                );
            })
            .map(file => relative(srcRoot, file));

        expect(violations).toEqual([]);
    });

    it('documents each operation with a Chinese summary', () => {
        // OpenAPI best practice: `summary` is the required short one-liner
        // shown in sidebars and lists; `description` is optional markdown
        // detail. We enforce summary only \u2014 endpoints that legitimately need
        // a description (multi-step flows, gotchas) should still add one as
        // a code-review concern, not a contract requirement.
        const violations: string[] = [];

        for (const file of controllerFiles) {
            const source = readFileSync(file, 'utf8');
            if (source.includes('@ApiExcludeController()')) continue;

            const lines = source.split('\n');
            lines.forEach((line, index) => {
                if (!routeDecoratorPattern.test(line)) return;

                const block = getDecoratorBlock(lines, index);
                if (/@ApiExcludeEndpoint\(\)/.test(block)) return;

                const noContentTextIsChinese = /@ApiNoContentResponse\(\s*['"`][^'"`]*[\u4e00-\u9fff]/.test(block);
                const hasChineseSummary =
                    /summary:\s*['"`][^'"`]*[\u4e00-\u9fff]/.test(block) || noContentTextIsChinese;

                if (!hasChineseSummary || !chinesePattern.test(block)) {
                    violations.push(`${relative(srcRoot, file)}:${index + 1}`);
                }
            });
        }

        expect(violations).toEqual([]);
    });

    it('documents SSE operations as event-stream raw responses', () => {
        const violations: string[] = [];

        for (const file of controllerFiles) {
            const source = readFileSync(file, 'utf8');
            if (source.includes('@ApiExcludeController()')) continue;

            const lines = source.split('\n');
            lines.forEach((line, index) => {
                if (!sseRouteDecoratorPattern.test(line)) return;

                const block = getDecoratorBlock(lines, index);
                const hasEventStreamRawResponse =
                    /@ApiRawResponse\(/.test(block) &&
                    /contentType:\s*['"`]text\/event-stream['"`]/.test(block);

                if (!hasEventStreamRawResponse) {
                    violations.push(`${relative(srcRoot, file)}:${index + 1}`);
                }
            });
        }

        expect(violations).toEqual([]);
    });
});
