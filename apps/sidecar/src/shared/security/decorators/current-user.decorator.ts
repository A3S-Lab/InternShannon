import { createParamDecorator, ExecutionContext } from '@nestjs/common';

interface DesktopRequest {
    user?: { sub?: string };
    userId?: string;
}

/**
 * Desktop sidecar has no account login. This keeps older controller signatures
 * stable by returning a single local owner id.
 */
export const CurrentUserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<DesktopRequest>();
    return request.user?.sub ?? request.userId ?? 'desktop-user';
});
