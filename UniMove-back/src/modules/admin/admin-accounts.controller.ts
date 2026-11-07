import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminRoute } from '../../common/decorators/admin.decorators';
import { CurrentUser } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../../common/decorators/auth.decorators';
import { AdminPermission } from '../../generated/prisma/enums';
import { AdminAccountsService } from './admin-accounts.service';
import {
  AdminAccountsQueryDto,
  AdminInvitesQueryDto,
  AdminRecoveriesQueryDto,
  ChangeOwnPasswordDto,
  ConfirmAuthenticatorDto,
  CreateAdminInviteDto,
  ReauthDto,
  RevokeAdminAccessDto,
  ReviewMfaRecoveryDto,
  UpdateAdminPermissionsDto,
} from './admin-iam.dto';
import { AdminSecurityService } from './admin-security.service';
import { AdminInvitesService } from './admin-invites.service';
import { AdminPermissionRoute } from './admin-permission.guard';
import { ADMIN_PERMISSION_CATALOG } from './admin-permissions';
import { AdminRecoveryService } from './admin-recovery.service';
import { AdminSessionsService } from './admin-sessions.service';

/** Mesma convenção das listas administrativas: array no corpo, total no header. */
function withTotal<T>(response: Response, result: { items: T[]; total: number }) {
  response.setHeader('X-Total-Count', String(result.total));
  return result.items;
}

@ApiTags('admin-iam')
@Controller('admin')
export class AdminAccountsController {
  constructor(
    private readonly accounts: AdminAccountsService,
    private readonly invites: AdminInvitesService,
    private readonly recovery: AdminRecoveryService,
    private readonly sessions: AdminSessionsService,
    private readonly security: AdminSecurityService,
  ) {}

  // ------------------------------------------------- catálogo e sessão própria

  /**
   * Catálogo de permissões: rótulos e descrições vêm do servidor para a tela não
   * repetir texto. Qualquer administrador autenticado pode ler.
   */
  @AdminRoute()
  @Get('permissions')
  permissionCatalog() {
    return { items: ADMIN_PERMISSION_CATALOG };
  }

  /** Resumo da própria conta: 2FA, senha, sessões e último acesso. */
  @AdminRoute()
  @Get('security/overview')
  securityOverview(@CurrentUser() user: AuthUser) {
    return this.security.overview(user);
  }

  /**
   * Troca de senha de quem está autenticado. A redefinição por e-mail é outra
   * coisa e fica em /admin/auth/password-reset, para quem perdeu o acesso.
   */
  @AdminRoute()
  @Patch('security/password')
  changeOwnPassword(@CurrentUser() user: AuthUser, @Body() dto: ChangeOwnPasswordDto) {
    return this.security.changePassword(user, dto);
  }

  @AdminRoute()
  @Post('security/recovery-codes')
  @HttpCode(HttpStatus.OK)
  regenerateRecoveryCodes(@CurrentUser() user: AuthUser, @Body() dto: ReauthDto) {
    return this.security.regenerateRecoveryCodes(user, dto);
  }

  @AdminRoute()
  @Post('security/authenticator/start')
  @HttpCode(HttpStatus.OK)
  startAuthenticatorReplacement(@CurrentUser() user: AuthUser, @Body() dto: ReauthDto) {
    return this.security.startAuthenticatorReplacement(user, dto);
  }

  @AdminRoute()
  @Post('security/authenticator/confirm')
  @HttpCode(HttpStatus.OK)
  confirmAuthenticatorReplacement(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmAuthenticatorDto,
  ) {
    return this.security.confirmAuthenticatorReplacement(user, dto);
  }

  @AdminRoute()
  @Get('sessions')
  mySessions(@CurrentUser() user: AuthUser) {
    return this.sessions.listMine(user);
  }

  @AdminRoute()
  @Delete('sessions/:id')
  revokeMySession(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.revokeMine(user, id);
  }

  @AdminRoute()
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  revokeMyOtherSessions(@CurrentUser() user: AuthUser) {
    return this.sessions.revokeOthers(user);
  }

  // ------------------------------------------------------- contas e permissões

  @AdminPermissionRoute(AdminPermission.MANAGE_ADMINS)
  @Get('admins')
  async listAdmins(
    @Query() query: AdminAccountsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.accounts.list(query);
    response.setHeader('X-Pending-Invites', String(result.pendingInvites));
    return withTotal(response, result);
  }

  @AdminPermissionRoute(AdminPermission.MANAGE_ADMINS)
  @Patch('admins/:id/permissions')
  updatePermissions(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAdminPermissionsDto,
  ) {
    return this.accounts.updatePermissions(user, id, dto);
  }

  @AdminPermissionRoute(AdminPermission.MANAGE_ADMINS)
  @Post('admins/:id/revoke')
  @HttpCode(HttpStatus.OK)
  revokeAccess(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RevokeAdminAccessDto,
  ) {
    return this.accounts.revokeAccess(user, id, dto);
  }

  @AdminPermissionRoute(AdminPermission.MANAGE_ADMINS)
  @Get('admins/:id/sessions')
  adminSessions(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sessions.listOf(id);
  }

  @AdminPermissionRoute(AdminPermission.MANAGE_ADMINS)
  @Post('admins/:id/sessions/revoke')
  @HttpCode(HttpStatus.OK)
  revokeAdminSessions(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReauthDto,
  ) {
    return this.sessions.revokeAllOf(user, id, dto);
  }

  // ------------------------------------------------------------------ convites

  @AdminPermissionRoute(AdminPermission.MANAGE_ADMINS)
  @Get('invites')
  async listInvites(
    @Query() query: AdminInvitesQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return withTotal(response, await this.invites.list(query));
  }

  @AdminPermissionRoute(AdminPermission.MANAGE_ADMINS)
  @Post('invites')
  @HttpCode(HttpStatus.CREATED)
  createInvite(@CurrentUser() user: AuthUser, @Body() dto: CreateAdminInviteDto) {
    return this.invites.create(user, dto);
  }

  @AdminPermissionRoute(AdminPermission.MANAGE_ADMINS)
  @Post('invites/:id/revoke')
  @HttpCode(HttpStatus.OK)
  revokeInvite(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.invites.revoke(user, id);
  }

  // ------------------------------------------- recuperação de segundo fator

  @AdminPermissionRoute(AdminPermission.MANAGE_ADMINS)
  @Get('mfa-recoveries')
  async listRecoveries(
    @Query() query: AdminRecoveriesQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return withTotal(response, await this.recovery.listRecoveries(query));
  }

  @AdminPermissionRoute(AdminPermission.MANAGE_ADMINS)
  @Post('mfa-recoveries/:id/review')
  @HttpCode(HttpStatus.OK)
  reviewRecovery(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewMfaRecoveryDto,
  ) {
    return this.recovery.reviewMfaRecovery(user, id, dto);
  }
}
