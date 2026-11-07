import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/auth.decorators';
import { NoStoreInterceptor } from '../../common/interceptors/no-store.interceptor';
import { assertAdminOrigin } from '../../common/security/admin-session';
import {
  AcceptInvitePasswordDto,
  AcceptInviteTwoFactorDto,
  AdminTokenDto,
  ConfirmMfaRecoveryDto,
  ConfirmPasswordResetDto,
  RequestMfaRecoveryDto,
  RequestPasswordResetDto,
  StartMfaRecoveryDto,
} from './admin-iam.dto';
import { AdminInvitesService } from './admin-invites.service';
import { AdminRecoveryService } from './admin-recovery.service';

/**
 * Passos que acontecem **antes** de existir sessão: aceitar convite, redefinir
 * senha e recuperar o autenticador. São públicos por natureza, e por isso cada
 * um só aceita requisição vinda da origem do painel, tem limite de tentativas
 * por IP (Throttle) e por token ou conta (AuthAttemptLimiter), e devolve
 * resposta neutra quando a existência da conta não deve ser revelada.
 *
 * Nenhuma destas rotas concede acesso administrativo por si: o papel ADMIN só
 * é atribuído na confirmação do segundo fator do convite, e a redefinição de
 * senha não desativa o segundo fator.
 */
@ApiTags('admin-iam-public')
@UseInterceptors(NoStoreInterceptor)
@Controller('admin/auth')
export class AdminOnboardingController {
  constructor(
    private readonly invites: AdminInvitesService,
    private readonly recovery: AdminRecoveryService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------- aceite de convite

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('invites/confirm-email')
  @HttpCode(HttpStatus.OK)
  confirmInviteEmail(@Body() dto: AdminTokenDto, @Req() request: Request) {
    this.assertOrigin(request);
    return this.invites.confirmEmail(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('invites/password')
  @HttpCode(HttpStatus.OK)
  setInvitePassword(@Body() dto: AcceptInvitePasswordDto, @Req() request: Request) {
    this.assertOrigin(request);
    return this.invites.setPassword(dto.token, dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('invites/two-factor')
  @HttpCode(HttpStatus.OK)
  confirmInviteTwoFactor(@Body() dto: AcceptInviteTwoFactorDto, @Req() request: Request) {
    this.assertOrigin(request);
    return this.invites.confirmTwoFactor(dto.token, dto);
  }

  // --------------------------------------------------- redefinição de senha

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('password-reset')
  @HttpCode(HttpStatus.ACCEPTED)
  requestPasswordReset(@Body() dto: RequestPasswordResetDto, @Req() request: Request) {
    this.assertOrigin(request);
    return this.recovery.requestPasswordReset(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto, @Req() request: Request) {
    this.assertOrigin(request);
    return this.recovery.confirmPasswordReset(dto);
  }

  // ------------------------------------------- recuperação do segundo fator

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('mfa-recovery')
  @HttpCode(HttpStatus.ACCEPTED)
  requestMfaRecovery(@Body() dto: RequestMfaRecoveryDto, @Req() request: Request) {
    this.assertOrigin(request);
    return this.recovery.requestMfaRecovery(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('mfa-recovery/start')
  @HttpCode(HttpStatus.OK)
  startMfaRecovery(@Body() dto: StartMfaRecoveryDto, @Req() request: Request) {
    this.assertOrigin(request);
    return this.recovery.startMfaRecovery(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('mfa-recovery/confirm')
  @HttpCode(HttpStatus.OK)
  confirmMfaRecovery(@Body() dto: ConfirmMfaRecoveryDto, @Req() request: Request) {
    this.assertOrigin(request);
    return this.recovery.confirmMfaRecovery(dto);
  }

  private assertOrigin(request: Request) {
    assertAdminOrigin(request, this.config.get<string[]>('admin.origins'));
  }
}
