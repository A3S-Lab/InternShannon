import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const routeDecoratorPattern = /^\s*@(Get|Post|Put|Patch|Delete|All|Head|Options)\(/;

function listControllerFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(entry => {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            return listControllerFiles(fullPath);
        }
        return fullPath.endsWith('controller.ts') ? [fullPath] : [];
    });
}

function findPreviousRouteLine(lines: string[], fromIndex: number): number {
    for (let index = fromIndex; index >= 0; index -= 1) {
        if (routeDecoratorPattern.test(lines[index])) {
            return index;
        }
    }
    return -1;
}

describe('raw response controller contract', () => {
    const srcRoot = resolve(__dirname, '../../..');
    const controllerFiles = listControllerFiles(srcRoot);

    it('documents manual @Res responses as raw responses and skips standard envelope wrapping', () => {
        const violations: string[] = [];

        for (const file of controllerFiles) {
            const source = readFileSync(file, 'utf8');
            if (source.includes('@ApiExcludeController()')) continue;

            const lines = source.split('\n');
            lines.forEach((line, index) => {
                if (!line.includes('@Res(') || line.includes('passthrough: true')) return;

                const routeLine = findPreviousRouteLine(lines, index);
                if (routeLine < 0) return;

                const routeBlock = lines.slice(routeLine, index + 1).join('\n');
                const hasRawResponseDecorator = /@ApiRawResponse\(/.test(routeBlock);
                const skipsStandardEnvelope = /@SkipApiResponse\(\)/.test(routeBlock);

                if (!hasRawResponseDecorator || !skipsStandardEnvelope) {
                    violations.push(`${relative(srcRoot, file)}:${index + 1}`);
                }
            });
        }

        expect(violations).toEqual([]);
    });
});
