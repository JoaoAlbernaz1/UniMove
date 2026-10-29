import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsString, IsStrongPassword, Length, MinLength } from 'class-validator';
import { MatchesProperty } from '../../../common/validators/matches-property';
import {
  PASSWORD_ERROR,
  passwordOptions,
  TERMS_VERSION,
  PRIVACY_POLICY_VERSION,
} from '../registration-policy';

export class RegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ApiProperty()
  @IsString()
  @MinLength(3, { message: 'Digite seu nome completo, com pelo menos 3 caracteres.' })
  fullName!: string;
  @ApiProperty({ example: '00000000000' }) @IsString() @Length(11, 14) cpf!: string;
  @ApiProperty({ example: 'aluno@ucb.edu.br' }) @IsEmail() institutionalEmail!: string;
  @ApiProperty({ minLength: 8 })
  @IsString()
  @IsStrongPassword(passwordOptions, { message: PASSWORD_ERROR })
  password!: string;
  @ApiProperty()
  @IsString()
  @MatchesProperty('password', { message: 'A confirmação precisa ser idêntica à senha.' })
  passwordConfirmation!: string;
  @ApiProperty({ example: true })
  @Equals(true, { message: 'Aceite os Termos de Uso e a Política de Privacidade para continuar.' })
  acceptedTerms!: boolean;
  @ApiProperty({ example: TERMS_VERSION })
  @Equals(TERMS_VERSION, { message: 'Os Termos de Uso foram atualizados. Reabra o cadastro.' })
  termsVersion!: string;
  @ApiProperty({ example: PRIVACY_POLICY_VERSION })
  @Equals(PRIVACY_POLICY_VERSION, {
    message: 'A Política de Privacidade foi atualizada. Reabra o cadastro.',
  })
  privacyPolicyVersion!: string;
}
export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}
export class RefreshDto {
  @IsString() refreshToken!: string;
}
