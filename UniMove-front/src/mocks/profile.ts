export const mockProfileExtras = {
  course: 'Engenharia',
  semester: '3º ano',
  bio: 'Estudante de Engenharia que adora compartilhar caronas para o campus. Sempre pontual e gosto de música ambiente durante o trajeto.',
  avatarUrl: null as string | null,
  tags: ['Música ambiente', 'Pontual', 'Não fuma', 'Aceita pets'],
};

export const mockStats = [
  { id: 'offered', value: 24, label: 'Caronas\nOferecidas', icon: 'map' },
  { id: 'received', value: 18, label: 'Caronas\nRecebidas', icon: 'calendar' },
  { id: 'rating', value: 4.9, label: 'Avaliação\nMédia', icon: 'star' },
] as const;

export const mockAchievements = [
  { id: 'trusted-driver', title: 'Motorista\nConfiável', type: 'trusted-driver' },
  { id: 'five-star-passenger', title: 'Passageiro 5\nEstrelas', type: 'five-star-passenger' },
] as const;

export const mockReviews = [
  { id: 'joao-santos', reviewerName: 'João Santos', initials: 'J', score: 4, comment: 'Excelente motorista! Muito pontual e educado.', date: '28 Abr' },
  { id: 'ana-costa', reviewerName: 'Ana Costa', initials: 'A', score: 5, comment: 'Ótima conversa e direção tranquila. Recomendo!', date: '25 Abr' },
  { id: 'marcos-lima', reviewerName: 'Marcos Lima', initials: 'M', score: 5, comment: 'Viagem segura, carro confortável e boa conversa durante o percurso.', date: '20 Abr' },
  { id: 'beatriz-souza', reviewerName: 'Beatriz Souza', initials: 'B', score: 4, comment: 'Chegou no horário combinado e respeitou todos os passageiros.', date: '18 Abr' },
  { id: 'rafael-mendes', reviewerName: 'Rafael Mendes', initials: 'R', score: 5, comment: 'Motorista pontual, muito educado e recomendado para novos trajetos.', date: '12 Abr' },
];
