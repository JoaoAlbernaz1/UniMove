import { ALLOWED_EMAIL_DOMAINS } from './config';

// Regras e mensagens da especificação do UC01 – Cadastrar Usuário.

const EMAIL_PATTERN = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

// RN04 / A02
export const INSTITUTIONAL_EMAIL_ERROR =
  'O e-mail informado não é um e-mail institucional válido. Utilize seu e-mail acadêmico.';

export function emailError(email: string) {
  const match = EMAIL_PATTERN.exec(email.trim().toLowerCase());
  if (!match) return 'Digite um e-mail universitário válido.';
  if (!ALLOWED_EMAIL_DOMAINS.includes(match[1])) return INSTITUTIONAL_EMAIL_ERROR;
  return null;
}

export const onlyDigits = (value: string) => value.replace(/\D/g, '');

// Máscara 000.000.000-00 (UC01 I01, campo 2).
export function formatCpf(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

// RN03: 11 dígitos e dígitos verificadores corretos. Mesma conta do backend.
export function isValidCpf(value: string) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

// RN02: mínimo 8 caracteres, com maiúscula, minúscula, número e caractere especial.
export const PASSWORD_RULES = [
  { label: 'Mínimo de 8 caracteres', test: (p: string) => p.length >= 8 },
  { label: 'Uma letra maiúscula', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Uma letra minúscula', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Um número', test: (p: string) => /\d/.test(p) },
  { label: 'Um caractere especial', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export const isStrongPassword = (password: string) => PASSWORD_RULES.every((rule) => rule.test(password));
