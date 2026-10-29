// Textos exibidos pelos links do aceite no cadastro (UC01). Versão provisória,
// montada a partir de UniMove-back/docs/LGPD.md: o texto final precisa ser
// revisado pelo grupo antes de publicar o app.
export type LegalDocument = {
  title: string;
  sections: { heading: string; body: string }[];
};

export const TERMS_OF_USE: LegalDocument = {
  title: 'Termos de Uso',
  sections: [
    {
      heading: 'Quem pode usar',
      body: 'O UniMove é exclusivo para a comunidade universitária. O cadastro exige e-mail institucional e CPF válido.',
    },
    {
      heading: 'Sua conta',
      body: 'Você é responsável pelas informações que cadastra e por manter sua senha em segredo. Não compartilhe sua conta.',
    },
    {
      heading: 'Caronas',
      body: 'O UniMove conecta motoristas e passageiros da universidade. Trate os colegas com respeito e cumpra os horários combinados. Avaliações e denúncias ajudam a manter a comunidade segura.',
    },
    {
      heading: 'Suspensão',
      body: 'Contas que descumprirem estes termos ou colocarem outros usuários em risco podem ser suspensas.',
    },
  ],
};

export const PRIVACY_POLICY: LegalDocument = {
  title: 'Política de Privacidade',
  sections: [
    {
      heading: 'Dados que tratamos',
      body: 'Nome, CPF, e-mail institucional, histórico de caronas, avaliações e incidentes.',
    },
    {
      heading: 'Para que usamos',
      body: 'Para identificar os membros da comunidade, operar as caronas, garantir a segurança de todos e manter registros de auditoria.',
    },
    {
      heading: 'Como protegemos',
      body: 'O acesso aos dados exige login e depende do seu papel no app. Senhas, tokens e o CPF completo nunca são gravados em registros do sistema.',
    },
    {
      heading: 'Seus direitos (LGPD)',
      body: 'Você pode pedir acesso, correção, portabilidade ou eliminação dos seus dados. Ao desativar a conta, seus dados são anonimizados quando isso não conflitar com obrigações de segurança e auditoria.',
    },
  ],
};
