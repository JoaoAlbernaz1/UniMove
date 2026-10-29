import type { ImageSourcePropType } from 'react-native';
import { colors } from '../theme';

export type Advertisement = {
  id: string;
  description: string;
  // Substitua por require('../../assets/ads/anuncio-1.png') ou { uri: 'https://...' }.
  image?: ImageSourcePropType;
  demonstrationSvg: string;
};

function demonstration(
  title: string,
  badge: string,
  background: string,
  foreground: string,
) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="88" viewBox="0 0 600 88">
    <rect x="1" y="1" width="598" height="86" rx="18" fill="${background}" stroke="${colors.accent}" stroke-width="2"/>
    <circle cx="42" cy="44" r="23" fill="${foreground}"/>
    <text x="42" y="52" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="${background}">${badge}</text>
    <text x="80" y="53" font-family="Arial, sans-serif" font-size="27" font-weight="bold" fill="${foreground}">${title}</text>
    <text x="575" y="51" text-anchor="end" font-family="Arial, sans-serif" font-size="14" fill="${foreground}">DEMO</text>
  </svg>`;
}

// Conteúdo visual de demonstração. A ordem e as três imagens são configuradas aqui.
export const advertisements: readonly Advertisement[] = [
  {
    id: 'advertisement-1',
    description: 'Propaganda de demonstração 1: seu anúncio aqui.',
    demonstrationSvg: demonstration(
      'Seu anúncio aqui',
      '1',
      colors.accent,
      colors.primary,
    ),
  },
  {
    id: 'advertisement-2',
    description: 'Propaganda de demonstração 2: novidades do campus.',
    demonstrationSvg: demonstration(
      'Novidades do campus',
      '2',
      colors.white,
      colors.primary,
    ),
  },
  {
    id: 'advertisement-3',
    description: 'Propaganda de demonstração 3: conecte sua marca.',
    demonstrationSvg: demonstration(
      'Conecte sua marca',
      '3',
      colors.primary,
      colors.white,
    ),
  },
];
