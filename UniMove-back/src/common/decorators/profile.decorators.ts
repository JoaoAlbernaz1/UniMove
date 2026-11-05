import { SetMetadata } from '@nestjs/common';
export const ALLOW_INCOMPLETE_PROFILE = 'allowIncompleteProfile';
export const AllowIncompleteProfile = () => SetMetadata(ALLOW_INCOMPLETE_PROFILE, true);
export const REQUIRE_ACADEMIC_VERIFICATION = 'requireAcademicVerification';
export const RequireAcademicVerification = () => SetMetadata(REQUIRE_ACADEMIC_VERIFICATION, true);
