import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../../common/auth/decorators';
import { AuthUser } from '../../common/auth/jwt-auth.guard';
import { AuthService } from './auth.service';
import { LoginRequest, LoginResponse, User } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginRequest): Promise<LoginResponse> {
    return this.auth.login(body.username, body.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<User> {
    return this.auth.me(user.id);
  }
}
