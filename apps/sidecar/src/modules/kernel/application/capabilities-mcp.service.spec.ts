import { CapabilitiesMcpService } from './capabilities-mcp.service';
import type { CapabilitiesToolService } from './capabilities-tool.service';

describe('CapabilitiesMcpService', () => {
    const dispatch = jest.fn();
    const toolDefinition = jest.fn().mockReturnValue({
        name: 'capabilities',
        description: 'Discover and execute capabilities',
        input_schema: { type: 'object', properties: {}, required: ['action'] },
    });
    const service = new CapabilitiesMcpService({ dispatch, toolDefinition } as unknown as CapabilitiesToolService);

    beforeEach(() => {
        dispatch.mockReset();
    });

    it('negotiates a stateless MCP session and exposes a standards-shaped tool definition', async () => {
        await expect(
            service.handle(
                {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: { protocolVersion: '2025-03-26' },
                },
                'desktop-user',
            ),
        ).resolves.toEqual(
            expect.objectContaining({
                status: 200,
                body: expect.objectContaining({
                    id: 1,
                    result: expect.objectContaining({ protocolVersion: '2025-03-26' }),
                }),
            }),
        );

        const list = await service.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, 'desktop-user');
        expect(list.body?.result).toEqual({
            tools: expect.arrayContaining([
                {
                    name: 'capabilities',
                    description: 'Discover and execute capabilities',
                    inputSchema: { type: 'object', properties: {}, required: ['action'] },
                },
                expect.objectContaining({ name: 'knowledge_search' }),
                expect.objectContaining({ name: 'knowledge_read' }),
            ]),
        });
    });

    it('maps direct knowledge tools onto the virtual knowledge module', async () => {
        dispatch.mockResolvedValue({ hits: [] });

        await service.handle(
            {
                jsonrpc: '2.0',
                id: 4,
                method: 'tools/call',
                params: {
                    name: 'knowledge_search',
                    arguments: { scope: 'personal', query: 'MARS-0000', limit: 8 },
                },
            },
            'desktop-user',
        );

        expect(dispatch).toHaveBeenCalledWith(
            {
                action: 'execute',
                module: 'knowledge',
                operation: 'search',
                params: { scope: 'personal', query: 'MARS-0000', limit: 8 },
            },
            'desktop-user',
        );
    });

    it('dispatches knowledge calls with the desktop owner and returns cited structured content', async () => {
        dispatch.mockResolvedValue({ hits: [{ path: 'concepts/renewal.md', content: 'BQ-7429' }] });

        const result = await service.handle(
            {
                jsonrpc: '2.0',
                id: 'call-1',
                method: 'tools/call',
                params: {
                    name: 'capabilities',
                    arguments: {
                        action: 'execute',
                        module: 'knowledge',
                        operation: 'search',
                        params: { scope: 'personal', query: 'BQ-7429' },
                    },
                },
            },
            'desktop-user',
        );

        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ module: 'knowledge', operation: 'search' }),
            'desktop-user',
        );
        expect(result.body?.result).toEqual(
            expect.objectContaining({
                structuredContent: { hits: [{ path: 'concepts/renewal.md', content: 'BQ-7429' }] },
                content: [{ type: 'text', text: expect.stringContaining('BQ-7429') }],
            }),
        );
    });

    it('returns MCP tool errors without failing the transport', async () => {
        dispatch.mockRejectedValue(new Error('知识库查询服务不可用'));

        const result = await service.handle(
            {
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: { name: 'capabilities', arguments: { action: 'list' } },
            },
            'desktop-user',
        );

        expect(result.status).toBe(200);
        expect(result.body?.result).toEqual(
            expect.objectContaining({ isError: true, content: [{ type: 'text', text: '知识库查询服务不可用' }] }),
        );
    });
});
