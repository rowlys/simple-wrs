import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-code';
import { ROLES } from './decorators';
import { AuthUser } from './jwt-auth.guard';

// Global guard registered after JwtAuthGuard: enforces @Roles(...) on the server (FR-03).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;

    const { user } = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (user && roles.includes(user.role)) return true;
    throw new AppError(ErrorCode.FORBIDDEN, 'You are not allowed to perform this action.');
  }
}
