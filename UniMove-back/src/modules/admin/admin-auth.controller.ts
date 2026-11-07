import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AdminRoute } from '../../common/decorators/admin.decorators';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { NoStoreInterceptor } from '../../common/interceptors/no-store.interceptor';
import {
  adminCookieNames,
  adminCookieOptions,
  assertAdminCsrf,
  assertAdminOrigin,
} from '../../common/security/admin-session';
import { ADMIN_CHALLENGE_MAX_AGE_MS, AdminAuthService } from './admin-auth.service';

class AdminLoginDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(200) password!: string;
}

class AdminSecondFactorDto {
  @IsString() @MaxLength(32) code!: string;
}

type IssuedSession = Awaited<ReturnType<AdminAuthService['refresh']>>;

@ApiTags('admin-auth')
@UseInterceptors(NoStoreInterceptor)
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: AdminLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertOrigin(request);
    const { challenge, ...result } = await this.auth.login(dto.email, dto.password);
    response.cookie(
      adminCookieNames().challenge,
      challenge,
      adminCookieOptions.challenge(ADMIN_CHALLENGE_MAX_AGE_MS),
    );
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('two-factor')
  @HttpCode(HttpStatus.OK)
  async twoFactor(
    @Body() dto: AdminSecondFactorDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertOrigin(request);
    const { session, ...result } = await this.auth.verifySecondFactor(
      this.cookie(request, 'challenge'),
      dto.code,
      request.headers['user-agent'],
    );
    response.clearCookie(adminCookieNames().challenge, adminCookieOptions.challenge());
    this.setSessionCookies(response, session);
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertOrigin(request);
    assertAdminCsrf(request);
    // Falha aqui não apaga cookies: em disputa entre abas, a outra já gravou os novos.
    const session = await this.auth.refresh(
      this.cookie(request, 'refresh'),
      request.headers['user-agent'],
    );
    this.setSessionCookies(response, session);
    return { refreshed: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.assertOrigin(request);
    assertAdminCsrf(request);
    await this.auth.logout(this.cookie(request, 'refresh'));
    this.clearSessionCookies(response);
  }

  @AdminRoute()
  @Get('session')
  session(@CurrentUser() user: AuthUser) {
    return this.auth.sessionUser(user.id);
  }

  private assertOrigin(request: Request) {
    assertAdminOrigin(request, this.config.get<string[]>('admin.origins'));
  }

  private cookie(request: Request, name: 'challenge' | 'refresh') {
    return (request.cookies as Record<string, string> | undefined)?.[adminCookieNames()[name]];
  }

  private setSessionCookies(response: Response, session: IssuedSession) {
    const names = adminCookieNames();
    response.cookie(
      names.access,
      session.accessToken,
      adminCookieOptions.access(session.accessMaxAgeMs),
    );
    response.cookie(
      names.refresh,
      session.refreshToken,
      adminCookieOptions.refresh(session.sessionMaxAgeMs),
    );
    response.cookie(
      names.csrf,
      session.csrfToken,
      adminCookieOptions.csrf(session.sessionMaxAgeMs),
    );
  }

  private clearSessionCookies(response: Response) {
    const names = adminCookieNames();
    response.clearCookie(names.access, adminCookieOptions.access());
    response.clearCookie(names.refresh, adminCookieOptions.refresh());
    response.clearCookie(names.csrf, adminCookieOptions.csrf());
  }
}
