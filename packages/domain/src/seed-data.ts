// Initial data: 8 life domains in priority order (Specs §3.10, décision (7)) with §11 colors,
// and the proposed groups of Specs §3.10.

export interface SeedDomain {
  name: string;
  colorLight: string;
  colorDark: string;
  /** Proposal (decision D-49): what belongs to the domain, so that the AI files projects correctly. */
  description: string;
}

export const SEED_DOMAINS: SeedDomain[] = [
  {
    name: 'Santé',
    colorLight: '#2F8F62',
    colorDark: '#4FBF8A',
    description:
      'Corps et esprit : sport, sommeil, alimentation, suivi médical, bien-être mental. Tout ce qui me garde en forme sur la durée. Pas ici : le matériel de sport (Maison) ni les sorties sportives entre amis (Amis & Social).',
  },
  {
    name: 'Famille',
    colorLight: '#D2691E',
    colorDark: '#F0954B',
    description:
      'Le temps et les projets avec ma famille proche : sorties, vacances, moments partagés, éducation, entraide. Pas ici : les travaux de la maison (Maison) ni les papiers administratifs (Patrimoine ou Inbox).',
  },
  {
    name: 'Carrière',
    colorLight: '#2F6FDB',
    colorDark: '#6A9BF2',
    description:
      'Mon activité professionnelle : missions, clients, montée en compétences, veille et projets techniques qui me font progresser dans mon métier (IA, labo). Pas ici : la veille par simple curiosité (Loisirs & Découverte).',
  },
  {
    name: 'Patrimoine',
    colorLight: '#A47A12',
    colorDark: '#D4A93A',
    description:
      'Argent et biens : épargne, placements, immobilier, business, fiscalité, budget. Ce qui construit ou protège mon patrimoine. Pas ici : les travaux concrets dans la maison (Maison).',
  },
  {
    name: 'Sécurité',
    colorLight: '#6B5BC4',
    colorDark: '#9A8CF0',
    description:
      'Se protéger et tenir en cas de coup dur : résilience (énergie, eau, réserves, coupures), sécurité numérique (sauvegardes, mots de passe, réseau), assurances.',
  },
  {
    name: 'Maison',
    colorLight: '#8A6448',
    colorDark: '#B88E6E',
    description:
      'Le lieu de vie : travaux, rénovation, jardin, équipement, entretien. Ce qui rend la maison plus agréable ou plus efficace.',
  },
  {
    name: 'Amis & Social',
    colorLight: '#B8487A',
    colorDark: '#E07AA6',
    description: 'Les relations hors famille : amis, réseau, sorties, événements, entretenir les liens.',
  },
  {
    name: 'Loisirs & Découverte',
    colorLight: '#1F8A9C',
    colorDark: '#4CC0D3',
    description:
      'Plaisir et curiosité : jeux, musique, lectures, voyages de découverte, apprendre pour le plaisir. Les expériences nouvelles y trouvent souvent leur place.',
  },
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
