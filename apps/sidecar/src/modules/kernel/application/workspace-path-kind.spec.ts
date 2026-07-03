import { isRemoteWorkspacePath, isWindowsDrivePath, workspaceUriScheme } from './workspace-path-kind';

describe('workspace path classification', () => {
    it.each([
        'D:/AI/Project/agents/users/local/sessions/default-20260703-184231270',
        'c:/Users/test/workspace',
        'D:\\AI\\Project\\agents',
        '\\\\server\\share\\workspace',
        '/var/tmp/workspace',
        'file:///D:/AI/Project/agents',
    ])('treats %s as a local workspace path', value => {
        expect(isRemoteWorkspacePath(value)).toBe(false);
    });

    it.each(['D:/AI/Project', 'c:\\Users\\test'])('detects %s as a Windows drive path', value => {
        expect(isWindowsDrivePath(value)).toBe(true);
        expect(workspaceUriScheme(value)).toBeUndefined();
    });

    it.each(['s3://bucket/workspace', 's3:/bucket/workspace', 'https://example.com/workspace'])(
        'treats %s as a remote workspace URI',
        value => {
            expect(isRemoteWorkspacePath(value)).toBe(true);
        },
    );
});
