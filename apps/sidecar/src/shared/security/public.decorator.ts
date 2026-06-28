import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as intentionally reachable without desktop-local context.
 * Desktop has no login flow; this metadata is route documentation only.
 */
export const PUBLIC_ROUTE_KEY = 'desktop:public-route';
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(PUBLIC_ROUTE_KEY, true);
