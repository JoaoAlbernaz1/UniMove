/**
 * Dígitos verificadores do CPF. Extraído de AuthService para o cadastro de
 * estudante e a ativação de administrador aplicarem exatamente a mesma regra.
 */
export function isValidCpf(cpf: string) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  const digit = (length: number) => {
    const sum = cpf
      .slice(0, length)
      .split('')
      .reduce((acc, number, index) => acc + Number(number) * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}
