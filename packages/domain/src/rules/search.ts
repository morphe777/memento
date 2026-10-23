// Spotlight search ranking (F-01 to F-04, dossier de dev §12): exact title > title prefix > word prefix >
// title contains > groups/domains > description; typo tolerance through trigram similarity on titles.

export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}

export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter || 1);
}

export interface Searchable {
  type: 'objective' | 'project' | 'idea' | 'task' | 'inbox';
  id: string;
  title: string;
  description: string;
  labels: string; // groups and domains
}

/** Relevance score; 0 = no match. */
export function relevance(q: string, item: Searchable): number {
  const query = fold(q);
  if (!query) return 0;
  const title = fold(item.title);
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.split(/[\s'’-]+/).some((w) => w.startsWith(query))) return 65;
  if (title.includes(query)) return 50;
  const words = query.split(' ');
  if (words.length > 1 && words.every((w) => title.includes(w))) return 45;
  if (fold(item.labels).includes(query)) return 30;
  if (fold(item.description).includes(query)) return 20;
  // Typo tolerance: best similarity between the query and any window of the title.
  const sim = Math.max(similarity(query, title), ...title.split(' ').map((w) => similarity(query, w)));
  return sim >= 0.35 ? Math.round(sim * 40) : 0;
}

export function rankResults(q: string, items: Searchable[], perType = 5) {
  const scored = items
    .map((item) => ({ item, score: relevance(q, item) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  const groups: Record<Searchable['type'], { id: string; title: string; score: number }[]> = {
    objective: [],
    project: [],
    idea: [],
    task: [],
    inbox: [],
  };
  for (const { item, score } of scored) {
    if (groups[item.type].length < perType) groups[item.type].push({ id: item.id, title: item.title, score });
  }
  return groups;
}
