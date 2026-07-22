import { extractOkfLinks, normalizeOkfPath, parseOkfDocument, resolveOkfLink, validateOkfBundle } from './open-knowledge-format';

describe('Open Knowledge Format v0.1', () => {
    it('parses concepts while preserving unknown frontmatter fields', () => {
        const raw = [
            '---',
            'type: Metric',
            'title: Revenue',
            'tags: [finance, sales]',
            'producer_extension:',
            '  owner: analytics',
            '---',
            '',
            '# Revenue',
        ].join('\n');

        const document = parseOkfDocument('metrics/revenue.md', raw);

        expect(document.frontmatter.type).toBe('Metric');
        expect(document.frontmatter.producer_extension).toEqual({ owner: 'analytics' });
        expect(document.body).toContain('# Revenue');
        expect(document.raw).toBe(raw);
    });

    it('validates required type but tolerates unknown types and broken links', () => {
        const result = validateOkfBundle({
            'index.md': '---\nokf_version: "0.1"\n---\n\n# Bundle\n',
            'concepts/valid.md': '---\ntype: Completely Custom Type\ntitle: Valid\n---\n\nSee [missing](/missing.md).\n',
            'concepts/invalid.md': '---\ntitle: Invalid\n---\n\nMissing type.\n',
        });

        expect(result.valid).toBe(false);
        expect(result.concepts).toEqual([
            expect.objectContaining({ conceptId: 'concepts/valid', type: 'Completely Custom Type' }),
        ]);
        expect(result.diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: 'missing_type', severity: 'error' }),
                expect.objectContaining({ code: 'broken_link', severity: 'warning' }),
            ]),
        );
    });

    it('resolves bundle-absolute and relative Markdown links', () => {
        expect(resolveOkfLink('tables/orders.md', '/tables/customers.md')).toBe('tables/customers.md');
        expect(resolveOkfLink('tables/orders.md', '../datasets/sales.md')).toBe('datasets/sales.md');
        expect(resolveOkfLink('tables/orders.md', 'https://example.com')).toBeNull();
        expect(extractOkfLinks('tables/orders.md', 'See [customers](./customers.md).')).toEqual([
            { rawTarget: './customers.md', resolvedPath: 'tables/customers.md' },
        ]);
    });

    it('rejects unsafe paths', () => {
        const result = validateOkfBundle({ '../outside.md': '---\ntype: Note\n---\n' });
        expect(result.valid).toBe(false);
        expect(result.diagnostics[0]).toMatchObject({ code: 'unsafe_path' });
    });

    it('accepts the official OKF v0.1 Appendix A bundle shape at the pinned Google revision', () => {
        // Source: GoogleCloudPlatform/knowledge-catalog okf/SPEC.md Appendix A,
        // revision d44368c15e38e7c92481c5992e4f9b5b421a801d (Apache-2.0).
        const result = validateOkfBundle({
            'index.md': '---\nokf_version: "0.1"\n---\n\n# Sales knowledge\n',
            'datasets/sales.md': [
                '---',
                'type: BigQuery Dataset',
                'title: Sales',
                'description: All sales-related tables for the retail business.',
                'resource: https://console.cloud.google.com/bigquery?p=acme&d=sales',
                'tags: [sales]',
                'timestamp: 2026-05-28T00:00:00Z',
                '---',
                '',
                'The sales dataset contains transactional tables, including',
                '[orders](/tables/orders.md) and [customers](/tables/customers.md).',
            ].join('\n'),
            'tables/orders.md': [
                '---',
                'type: BigQuery Table',
                'title: Orders',
                'description: One row per completed customer order.',
                'tags: [sales, orders]',
                '---',
                '',
                'FK to [customers](/tables/customers.md).',
                'Part of the [sales dataset](/datasets/sales.md).',
            ].join('\n'),
            'tables/customers.md': '---\ntype: BigQuery Table\ntitle: Customers\n---\n\nCustomer records.\n',
        });

        expect(result.valid).toBe(true);
        expect(result.version).toBe('0.1');
        expect(result.conceptCount).toBe(3);
        expect(result.diagnostics).toEqual([]);
    });

    it('keeps consuming a future OKF version with an explicit migration diagnostic', () => {
        const result = validateOkfBundle({
            'index.md': '---\nokf_version: "0.2"\n---\n',
            'note.md': '---\ntype: Future Note\nproducer_extension: keep-me\n---\n\nBody\n',
        });

        expect(result.valid).toBe(true);
        expect(result.version).toBe('0.2');
        expect(result.diagnostics).toEqual([
            expect.objectContaining({ code: 'unknown_version', severity: 'warning' }),
        ]);
        expect(result.concepts[0].extensions).toEqual({ producer_extension: 'keep-me' });
    });

    it('keeps 2000 deterministic path mutations inside the bundle root', () => {
        const random = seededRandom(0x4f4b4601);
        const atoms = ['concepts', 'tables', 'a b', '.', '..', '', '\\windows', 'nested', 'x\0y'];
        for (let iteration = 0; iteration < 2000; iteration += 1) {
            const count = 1 + Math.floor(random() * 8);
            const input = Array.from({ length: count }, () => atoms[Math.floor(random() * atoms.length)]).join(
                random() > 0.5 ? '/' : '\\',
            );
            const normalized = normalizeOkfPath(input);
            if (normalized === null) continue;
            expect(normalized).not.toContain('\\');
            expect(normalized).not.toContain('\0');
            expect(normalized.split('/')).not.toContain('..');
            expect(normalizeOkfPath(normalized)).toBe(normalized);
        }
    });

    it('handles deterministic frontmatter and link mutations without escaping or non-Error crashes', () => {
        const random = seededRandom(0x4f4b4602);
        const yamlValues = ['Note', '"Quoted"', '[a, b]', '{ owner: test }', '[broken', '*alias', 'null', '42'];
        for (let iteration = 0; iteration < 500; iteration += 1) {
            const type = yamlValues[Math.floor(random() * yamlValues.length)];
            const target = random() > 0.5 ? `../${iteration}/target.md` : `./target-${iteration}.md`;
            const raw = `---\ntype: ${type}\ntitle: Fuzz ${iteration}\n---\n\nSee [target](${target}).\n`;
            try {
                const document = parseOkfDocument(`fuzz/case-${iteration}.md`, raw);
                expect(document.path).toBe(`fuzz/case-${iteration}.md`);
                for (const link of extractOkfLinks(document.path, document.body)) {
                    if (link.resolvedPath !== null) {
                        expect(link.resolvedPath).not.toContain('..');
                        expect(link.resolvedPath).not.toContain('\\');
                    }
                }
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }
        }
    });
});

function seededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
}
