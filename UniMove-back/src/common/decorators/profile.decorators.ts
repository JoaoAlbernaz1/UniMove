import { SetMetadata } from '@nestjs/common';
export const ALLOW_INCOMPLETE_PROFILE = 'allowIncompleteProfile';
export const AllowIncompleteProfile = () => SetMetadata(ALLOW_INCOMPLETE_PROFILE, true);
