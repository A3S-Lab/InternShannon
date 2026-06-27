import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route as intentionally reachable without desktop-local context.
 * Desktop has no login flow; this metadata remains only for route
 * documentation and compatibility with existing controller decorators.
 */
export const PUBLIC_ROUTE_KEY = 'auth:public-route';
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(PUBLIC_ROUTE_KEY, true);
