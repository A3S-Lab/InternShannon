// ============================================================================
// Shared Module - Common utilities and components
// ============================================================================

// API Layer
export * from './api';
export * from './common/errors';
export * from './common/saga';
// Domain (DDD core - pure TypeScript, no framework imports)
export * from './domain';
export * from './infrastructure/config';
// Infrastructure
export * from './infrastructure/logging';
export * from './infrastructure/messaging';
export * from './infrastructure/persistence';
// Observability
export * from './observability/health';
export * from './observability/metrics';
// Security
export * from './security';

// Utils
export * from './utils';
