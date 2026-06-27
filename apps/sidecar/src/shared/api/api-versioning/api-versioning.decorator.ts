// ============================================================================
// API Versioning Decorators
// ============================================================================

import { SetMetadata } from '@nestjs/common';

export const API_VERSION_KEY = 'api_version';
export const API_DEPRECATED_KEY = 'isDeprecated';
export const API_SUNSET_DATE_KEY = 'sunsetDate';

/**
 * Set API version for a controller or route
 */
export const ApiVersion = (version: string | string[]) => SetMetadata(API_VERSION_KEY, version);

/**
 * Mark endpoint as deprecated
 */
export const Deprecated = () => SetMetadata(API_DEPRECATED_KEY, true);

/**
 * Set sunset date for endpoint
 */
export const Sunset = (date: Date) => SetMetadata(API_SUNSET_DATE_KEY, date);
