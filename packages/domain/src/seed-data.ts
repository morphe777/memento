// Initial data: 8 life domains in priority order (Specs §3.10, décision (7)) with §11 colors,
// and the proposed groups of Specs §3.10.

export interface SeedDomain {
  name: string;
  colorLight: string;
  colorDark: string;
}

export const SEED_DOMAINS: SeedDomain[] = [
  { name: 'Santé', colorLight: '#2F8F62', colorDark: '#4FBF8A' },
  { name: 'Famille', colorLight: '#D2691E', colorDark: '#F0954B' },
  { name: 'Carrière', colorLight: '#2F6FDB', colorDark: '#6A9BF2' },
  { name: 'Patrimoine', colorLight: '#A47A12', colorDark: '#D4A93A' },
  { name: 'Sécurité', colorLight: '#6B5BC4', colorDark: '#9A8CF0' },
  { name: 'Maison', colorLight: '#8A6448', colorDark: '#B88E6E' },
  { name: 'Amis & Social', colorLight: '#B8487A', colorDark: '#E07AA6' },
  { name: 'Loisirs & Découverte', colorLight: '#1F8A9C', colorDark: '#4CC0D3' },
];

/** Pseudo-domain used for Inbox tasks without a domain (display only). */
export const INBOX_COLORS = { light: '#7A7A75', dark: '#9A9A94' };

/** Default priority weight from rank (decision D-07): linear, 1.0 for rank 1 down to 1/8 for rank 8. */
export const defaultWeight = (rank: number, count = SEED_DOMAINS.length): number =>
  Math.round(((count - rank + 1) / count) * 1000) / 1000;

export const SEED_GROUPS: Record<string, string[]> = {
  Santé: ['Sport', 'Repas', 'Outils perso'],
  Famille: ['Sorties & activités famille'],
  Carrière: ['Mission', 'MYARCHI', 'IA', 'Labo Tech'],
  Patrimoine: ['Business', 'Immobilier', 'Bourse', 'Crypto', 'Patrimoine existant'],
  Sécurité: ['Résilience', 'Sécu digitale'],
  Maison: ['Travaux', 'Jardin', 'Équipement'],
  'Amis & Social': ['Sorties amis', 'Réseau'],
  'Loisirs & Découverte': ['Gaming', 'Audio & Musique', 'Veille'],
};
