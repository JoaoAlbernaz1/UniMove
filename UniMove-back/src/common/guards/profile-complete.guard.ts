import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, type AuthUser } from '../decorators/auth.decorators';
import {
  ALLOW_INCOMPLETE_PROFILE,
  REQUIRE_ACADEMIC_VERIFICATION,
} from '../decorators/profile.decorators';
import { PrismaService } from '../../database/prisma.service';
import { AcademicVerificationStatus, RoleName } from '../../generated/prisma/enums';

@Injectable()
export class ProfileCompleteGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const allowIncompleteProfile = this.reflector.getAllAndOverride<boolean>(
      ALLOW_INCOMPLETE_PROFILE,
      targets,
    );
    const requireAcademicVerification = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_ACADEMIC_VERIFICATION,
      targets,
    );
    if (allowIncompleteProfile && !requireAcademicVerification) return true;
    const { user } = context.switchToHttp().getRequest<{ user: AuthUser }>();
    const enforceAcademicVerification =
      requireAcademicVerification && !user.roles.includes(RoleName.ADMIN);
    const profile = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        profileCompletedAt: true,
        ...(enforceAcademicVerification
          ? { academicVerification: { select: { status: true } } }
          : {}),
      },
    });
    if (!allowIncompleteProfile && !profile?.profileCompletedAt)
      throw new ForbiddenException({
        code: 'PROFILE_INCOMPLETE',
        message:
          'Complete seu perfil com curso, período, Sobre e pelo menos 3 tags para continuar.',
      });
    if (
      enforceAcademicVerification &&
      profile?.academicVerification?.status !== AcademicVerificationStatus.APPROVED
    )
      throw new ForbiddenException({
        code: 'ACADEMIC_VERIFICATION_REQUIRED',
        message:
          'Para buscar ou oferecer caronas, conclua sua validação cadastral. Envie seu comprovante de matrícula e aguarde a aprovação.',
      });
    return true;
  }
}
