import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfig } from '../../config/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    // global: the app-wide JwtAuthGuard needs JwtService too.
    JwtModule.registerAsync({
      global: true,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256', expiresIn: config.jwtExpiresInSeconds },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
