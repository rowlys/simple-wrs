import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-code';
import { IS_PUBLIC } from './decorators';

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
}

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

// Global guard (APP_GUARD): every route needs a valid Bearer token unless marked @Public() (FR-02).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    const unauthenticated = new AppError(ErrorCode.UNAUTHENTICATED, 'Missing, invalid or expired token.');
    if (scheme !== 'Bearer' || !token) throw unauthenticated;

    try {
      // Secret and the HS256-only algorithm list come from the JwtModule registration.
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      request.user = { id: payload.sub, username: payload.username, role: payload.role };
      return true;
    } catch {
      throw unauthenticated;
    }
  }
}
