import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface DesktopOwnerRequest {
    user?: { sub?: string };
    userId?: string;
}

/**
 * Desktop sidecar has no account login. Return the stable local owner id while
 * preserving older request fields used by existing controller call sites.
 */
export const DesktopOwnerId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<DesktopOwnerRequest>();
    return request.user?.sub ?? request.userId ?? 'desktop-user';
});
