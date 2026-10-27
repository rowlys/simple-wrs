import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { AuthUser } from './jwt-auth.guard';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Opts a handler or controller out of the global JwtAuthGuard (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Roles allowed to call the handler (spec §8). Without @Roles any authenticated user may call it. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

/** The user from the verified token. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user,
);
