import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '../registration-policy';
import { RegisterDto } from './auth.dto';

const valid = {
  fullName: '  Maria Souza  ',
  cpf: '52998224725',
  institutionalEmail: 'maria@ucb.edu.br',
  password: 'Senha123!',
  passwordConfirmation: 'Senha123!',
  acceptedTerms: true,
  termsVersion: TERMS_VERSION,
  privacyPolicyVersion: PRIVACY_POLICY_VERSION,
};

describe('Contrato de cadastro', () => {
  it('normaliza o nome antes de validar', async () => {
    const dto = plainToInstance(RegisterDto, valid);
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.fullName).toBe('Maria Souza');
  });
  it.each(['   ', ' a '])('recusa nome insuficiente após normalização: %p', async (fullName) => {
    const errors = await validate(plainToInstance(RegisterDto, { ...valid, fullName }));
    expect(errors.some((error) => error.property === 'fullName')).toBe(true);
  });
  it.each(['abcdefgh', 'ABCDEFGH', 'Senhaabc!', 'senha123!', 'SENHA123!', 'Senha123', 'A1!a'])(
    'garante todos os requisitos de senha na API: %s',
    async (password) => {
      const errors = await validate(
        plainToInstance(RegisterDto, { ...valid, password, passwordConfirmation: password }),
      );
      expect(errors.some((error) => error.property === 'password')).toBe(true);
    },
  );
  it.each([
    { passwordConfirmation: 'Outra123!' },
    { passwordConfirmation: undefined },
    { acceptedTerms: false },
    { acceptedTerms: undefined },
    { acceptedTerms: 'true' },
    { termsVersion: 'versao-antiga' },
    { privacyPolicyVersion: 'versao-antiga' },
  ])('recusa confirmação ou aceite inválido: %p', async (change) => {
    expect(await validate(plainToInstance(RegisterDto, { ...valid, ...change }))).not.toHaveLength(
      0,
    );
  });
});
