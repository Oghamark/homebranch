import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtTokenGateway } from 'src/infrastructure/gateways/jwt_token.gateway';
import { JwtStrategy } from 'src/infrastructure/strategies/jwt.strategy';
import { JwtAuthGuard } from 'src/infrastructure/guards/jwt-auth.guard';
import { RolesGuard } from 'src/infrastructure/guards/roles.guard';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
  ],
  providers: [
    {
      provide: 'TokenGateway',
      useClass: JwtTokenGateway,
    },

    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: ['TokenGateway', JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
