// PaginationDto usa @Type do class-transformer, que depende do reflect-metadata.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AdminPermission } from '../../generated/prisma/enums';
import {
  AcceptInvitePasswordDto,
  ConfirmPasswordResetDto,
  CreateAdminInviteDto,
  ReauthDto,
  RequestMfaRecoveryDto,
  UpdateAdminPermissionsDto,
} from './admin-iam.dto';
import {
  ADMIN_PERMISSION_CATALOG,
  ADMIN_PERMISSIONS,
  normalizePermissions,
} from './admin-permissions';

/** Campos que falharam, uma vez cada: um campo pode quebrar várias regras. */
const errorsOf = <T extends object>(cls: new () => T, payload: unknown) =>
  [
    ...new Set(
      validateSync(plainToInstance(cls, payload) as object, { whitelist: true }).map(
        (error) => error.property,
      ),
    ),
  ].sort();

describe('DTOs da gestão de identidade administrativa', () => {
  it('a reautenticação exige senha e código de seis dígitos', () => {
    expect(errorsOf(ReauthDto, { password: 'x', twoFactorCode: '123456' })).toEqual([]);
    expect(errorsOf(ReauthDto, { password: 'x', twoFactorCode: '12345' })).toEqual([
      'twoFactorCode',
    ]);
    expect(errorsOf(ReauthDto, {})).toEqual(['password', 'twoFactorCode']);
  });

  it('o convite recusa permissão fora do catálogo e permissão repetida', () => {
    const base = { email: 'pessoa@ucb.edu.br', fullName: 'Pessoa Convidada' };
    expect(errorsOf(CreateAdminInviteDto, { ...base, permissions: [] })).toEqual([]);
    expect(
      errorsOf(CreateAdminInviteDto, { ...base, permissions: [AdminPermission.MANAGE_ADMINS] }),
    ).toEqual([]);
    expect(errorsOf(CreateAdminInviteDto, { ...base, permissions: ['SUPER_ROOT'] })).toEqual([
      'permissions',
    ]);
    expect(
      errorsOf(CreateAdminInviteDto, {
        ...base,
        permissions: [AdminPermission.VIEW_AUDIT, AdminPermission.VIEW_AUDIT],
      }),
    ).toEqual(['permissions']);
  });

  it('o convite exige e-mail válido e nome com pelo menos três caracteres', () => {
    expect(
      errorsOf(CreateAdminInviteDto, { email: 'sem-arroba', fullName: 'Ana', permissions: [] }),
    ).toEqual(['email']);
    expect(
      errorsOf(CreateAdminInviteDto, { email: 'a@ucb.edu.br', fullName: 'Ab', permissions: [] }),
    ).toEqual(['fullName']);
  });

  it('a senha do aceite segue a política do cadastro', () => {
    const token = 'x'.repeat(43);
    expect(errorsOf(AcceptInvitePasswordDto, { token, password: 'SenhaForte123!' })).toEqual([]);
    expect(errorsOf(AcceptInvitePasswordDto, { token, password: 'senhafraca' })).toEqual([
      'password',
    ]);
    expect(errorsOf(AcceptInvitePasswordDto, { token, password: 'Curta1!' })).toEqual(['password']);
    // Conta existente manda só a senha atual: os outros campos são opcionais.
    expect(errorsOf(AcceptInvitePasswordDto, { token, currentPassword: 'qualquer' })).toEqual([]);
  });

  it('a redefinição de senha aplica a mesma política e exige token', () => {
    expect(
      errorsOf(ConfirmPasswordResetDto, { token: 'x'.repeat(43), password: 'SenhaForte123!' }),
    ).toEqual([]);
    expect(
      errorsOf(ConfirmPasswordResetDto, { token: 'curto', password: 'SenhaForte123!' }),
    ).toEqual(['token']);
    expect(
      errorsOf(ConfirmPasswordResetDto, { token: 'x'.repeat(43), password: 'semmaiuscula1!' }),
    ).toEqual(['password']);
  });

  it('o pedido de recuperação exige motivo com conteúdo', () => {
    const base = { email: 'pessoa@ucb.edu.br', password: 'SenhaForte123!' };
    expect(errorsOf(RequestMfaRecoveryDto, { ...base, reason: 'Perdi o celular' })).toEqual([]);
    expect(errorsOf(RequestMfaRecoveryDto, { ...base, reason: 'curto' })).toEqual(['reason']);
  });

  it('alterar permissões exige reautenticação e motivo no mesmo pedido', () => {
    expect(
      errorsOf(UpdateAdminPermissionsDto, {
        permissions: [AdminPermission.VIEW_AUDIT],
        reason: 'Motivo registrado',
        password: 'SenhaForte123!',
        twoFactorCode: '123456',
      }),
    ).toEqual([]);
    expect(
      errorsOf(UpdateAdminPermissionsDto, {
        permissions: [AdminPermission.VIEW_AUDIT],
        reason: 'Motivo registrado',
      }),
    ).toEqual(['password', 'twoFactorCode']);
  });

  it('o espaço em volta do código e do motivo é removido antes de validar', () => {
    const dto = plainToInstance(ReauthDto, { password: 'x', twoFactorCode: '  123456  ' });
    expect(dto.twoFactorCode).toBe('123456');
  });
});

describe('catálogo de permissões', () => {
  it('descreve todas as permissões do enum, sem sobra nem falta', () => {
    expect(ADMIN_PERMISSION_CATALOG.map((item) => item.value).sort()).toEqual(
      [...ADMIN_PERMISSIONS].sort(),
    );
    for (const item of ADMIN_PERMISSION_CATALOG) {
      expect(item.label.length).toBeGreaterThan(3);
      expect(item.description.length).toBeGreaterThan(10);
    }
  });

  it('marca como sensível só a permissão que dá poder sobre outros administradores', () => {
    expect(ADMIN_PERMISSION_CATALOG.filter((item) => item.sensitive).map((i) => i.value)).toEqual([
      AdminPermission.MANAGE_ADMINS,
    ]);
  });

  it('normaliza na ordem do catálogo e sem repetição', () => {
    expect(
      normalizePermissions([
        AdminPermission.VIEW_AUDIT,
        AdminPermission.MANAGE_ADMINS,
        AdminPermission.VIEW_AUDIT,
      ]),
    ).toEqual([AdminPermission.MANAGE_ADMINS, AdminPermission.VIEW_AUDIT]);
    expect(normalizePermissions([])).toEqual([]);
  });
});
