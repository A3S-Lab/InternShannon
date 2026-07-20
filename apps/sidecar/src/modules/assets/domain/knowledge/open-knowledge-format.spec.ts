import { extractOkfLinks, parseOkfDocument, resolveOkfLink, validateOkfBundle } from './open-knowledge-format';

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
});
