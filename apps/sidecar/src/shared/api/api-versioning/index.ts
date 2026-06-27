// ============================================================================
// API Versioning Module
// ============================================================================

export { ApiVersion, Deprecated, Sunset } from './api-versioning.decorator';
export {
    API_SUPPORTED_VERSIONS_HEADER,
    API_VERSION_HEADER,
    ApiVersioningInterceptor,
    DEFAULT_API_VERSION,
    SUPPORTED_API_VERSIONS,
    applyApiVersionHeaders,
    assertConsistentApiVersion,
    assertSupportedApiVersion,
    extractRequestedApiVersion,
    extractRequestedApiVersionCandidates,
    extractVersionFromCustomHeader,
    extractVersionFromHeader,
    extractVersionFromUrl,
    isSupportedApiVersion,
    normalizeApiVersion,
    resolveRequestedApiVersion,
} from './api-versioning.interceptor';
