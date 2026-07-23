import { SIDECAR_API_CSP_DIRECTIVES } from './desktop-csp';

describe('desktop sidecar CSP', () => {
    it('treats the sidecar as an API origin with no executable document resources', () => {
        expect(SIDECAR_API_CSP_DIRECTIVES['default-src']).toEqual(["'none'"]);
        expect(SIDECAR_API_CSP_DIRECTIVES['script-src']).toEqual(["'none'"]);
        expect(SIDECAR_API_CSP_DIRECTIVES['style-src']).toEqual(["'none'"]);
        expect(SIDECAR_API_CSP_DIRECTIVES['frame-ancestors']).toEqual(["'none'"]);
        expect(JSON.stringify(SIDECAR_API_CSP_DIRECTIVES)).not.toContain('unsafe-inline');
        expect(JSON.stringify(SIDECAR_API_CSP_DIRECTIVES)).not.toContain('unsafe-eval');
        expect(JSON.stringify(SIDECAR_API_CSP_DIRECTIVES)).not.toContain('https:');
    });
});
