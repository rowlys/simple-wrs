import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User as UserRow } from '@prisma/client';
import { compare } from 'bcrypt';
import { JwtPayload } from '../../common/auth/jwt-auth.guard';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-code';
import { AppConfig } from '../../config/config';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginResponse, User } from './dto/login.dto';

// bcrypt (cost 10) hash of a random string nobody knows. Comparing against it when the username
// does not exist keeps the response time the same as for a wrong password (AC-01.2).
const DUMMY_HASH = '$2b$10$pT/Y2TLrM83n5ACd9i4.YuK6jYEId5nMfkcnU.y9iCSow9bsJasMa';

const toUser = ({ id, username, fullName, role }: UserRow): User => ({ id, username, fullName, role });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async login(username: string, password: string): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    const passwordMatches = await compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordMatches) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid username or password');
    }

    const payload: JwtPayload = { sub: user.id, username: user.username, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(payload),
      expiresIn: this.config.jwtExpiresInSeconds,
      user: toUser(user),
    };
  }

  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing, invalid or expired token.');
    return toUser(user);
  }
}
