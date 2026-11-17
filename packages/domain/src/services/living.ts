// EX-60 / D-167: « Vivre », what one lived over a period (quarter report, year view): how many souvenirs and
// days, with whom, where, what looks alike, what was new, what to do again, and « Sortir des sentiers battus »
// (types never done, places of wishes never visited, people rarely seen). The soft alert per person (QE-07)
// goes here, never in a notification.
import type { Ctx } from '../context.ts';
import { ctxNow } from '../context.ts';
import { getSettings } from '../settings.ts';
import { daysBetween, parisDate } from '../time.ts';
import { listPersons } from './persons.ts';
import { distanceM } from './places.ts';
import { listSouvenirs, type SouvenirView } from './souvenirs.ts';
import { listWishes } from './wishes.ts';

/** French labels of the place categories (D-161). */
export const CATEGORY_LABEL: Record<string, string> = {
  restaurant: 'Restaurants',
  cafe: 'Cafés',
  bar: 'Bars',
  theatre: 'Théâtres',
  cinema: 'Cinémas',
  museum: 'Musées',
  venue: 'Salles et lieux culturels',
  attraction: 'Sites et attractions',
  park: 'Parcs et jardins',
  nature: 'Nature',
  cave: 'Grottes',
  sport: 'Sport',
  monument: 'Monuments',
  shop: 'Commerces',
  hotel: 'Hébergements',
  address: 'Adresses',
  city: 'Villes',
  other: 'Autres lieux',
};
/** The kinds of outings « Sortir des sentiers battus » looks for. */
const OUTING_KINDS = [
  'restaurant',
  'theatre',
  'cinema',
  'museum',
  'venue',
  'attraction',
  'park',
  'nature',
  'cave',
  'sport',
  'monument',
];

/** Days of a souvenir inside [from, to]. */
const daysIn = (s: SouvenirView, from: string, to: string) => {
  const a = s.startDate > from ? s.startDate : from;
  const end = s.endDate ?? s.startDate;
  const b = end < to ? end : to;
  return b >= a ? daysBetween(a, b) + 1 : 0;
};

export function livingReport(ctx: Ctx, from: string, to: string) {
  const all = listSouvenirs(ctx).filter((s) => s.status === 'saved' || s.status === 'draft');
  const inPeriod = all.filter((s) => s.startDate <= to && (s.endDate ?? s.startDate) >= from);
  const before = all.filter((s) => s.startDate < from);
  const today = parisDate(ctxNow(ctx));
  const home = getSettings(ctx)['places.home'];
  const persons = listPersons(ctx).filter((p) => p.active && !p.toConfirm);

  const byPerson = persons
    .map((p) => {
      const mine = inPeriod.filter((s) => s.persons.some((x) => x.id === p.id));
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        souvenirs: mine.length,
        days: mine.reduce((a, s) => a + daysIn(s, from, to), 0),
      };
    })
    .sort((a, b) => b.souvenirs - a.souvenirs || a.name.localeCompare(b.name, 'fr'));
  const total = inPeriod.length;
  const rare = byPerson.filter((p) => p.souvenirs <= (total >= 6 ? 1 : 0)).map((p) => p.name);

  const count = (key: (s: SouvenirView) => string | null) => {
    const m = new Map<string, number>();
    for (const s of inPeriod) {
      const k = key(s);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count);
  };
  const categories = count((s) => s.place?.category ?? null).map((c) => ({
    ...c,
    key: c.name,
    name: CATEGORY_LABEL[c.name] ?? c.name,
  }));
  const zones = count((s) => s.place?.city || null);
  const dists = home
    ? inPeriod
        .filter((s) => s.place)
        .map((s) => distanceM(home, s.place!))
        .sort((a, b) => a - b)
    : [];
  const medianKm = dists.length ? Math.round(dists[Math.floor(dists.length / 2)] / 100) / 10 : null;

  // « Ce qui se ressemble »: the biggest share of one kind of place (« 7 restaurants sur 10 souvenirs »).
  const top = categories[0];
  const alike =
    top && total >= 3 && top.count / total >= 0.4
      ? { key: top.key, label: top.name, count: top.count, of: total }
      : null;

  // Nouveautés (DE-07): the first souvenir ever of a kind of place or of a town, computed, never ticked.
  const seenKinds = new Set(before.map((s) => s.place?.category).filter(Boolean));
  const seenZones = new Set(before.map((s) => s.place?.city).filter(Boolean));
  const novelties: { souvenirId: string; title: string; what: string }[] = [];
  for (const s of [...inPeriod].sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const k = s.place?.category;
    if (k && OUTING_KINDS.includes(k) && !seenKinds.has(k)) {
      novelties.push({
        souvenirId: s.id,
        title: s.title,
        what: `premier lieu « ${CATEGORY_LABEL[k] ?? k} »`,
      });
      seenKinds.add(k);
    }
    const z = s.place?.city;
    if (z && !seenZones.has(z)) {
      novelties.push({ souvenirId: s.id, title: s.title, what: `première fois à ${z}` });
      seenZones.add(z);
    }
  }

  // « Sortir des sentiers battus »: the entry of the future activity engine.
  const everKinds = new Set(all.map((s) => s.place?.category).filter(Boolean));
  const everZones = new Set(all.map((s) => s.place?.city).filter(Boolean));
  const wishZones = [
    ...new Set(
      listWishes(ctx)
        .map((w) => w.place?.city)
        .filter((c): c is string => !!c && !everZones.has(c)),
    ),
  ];
  const offTrack = {
    kindsNeverDone: OUTING_KINDS.filter((k) => !everKinds.has(k)).map((k) => CATEGORY_LABEL[k]),
    zonesNeverVisited: wishZones.slice(0, 8),
    rarePeople: rare,
  };

  // QE-07: « Aucun souvenir avec Tom depuis 90 jours », for the people with an alert set.
  const alerts = persons
    .filter((p) => p.alertAfterDays)
    .map((p) => {
      const last = all
        .filter((s) => s.persons.some((x) => x.id === p.id))
        .map((s) => s.endDate ?? s.startDate)
        .sort()
        .at(-1);
      const since = last ? daysBetween(last, today) : null;
      return { personId: p.id, name: p.name, afterDays: p.alertAfterDays!, lastDate: last ?? null, since };
    })
    .filter((a) => a.since === null || a.since >= a.afterDays)
    .map((a) => ({
      ...a,
      text: a.lastDate
        ? `Aucun souvenir avec ${a.name} depuis ${a.since} jours`
        : `Pas encore de souvenir avec ${a.name}`,
    }));

  return {
    from,
    to,
    souvenirs: total,
    days: inPeriod.reduce((a, s) => a + daysIn(s, from, to), 0),
    places: new Set(inPeriod.map((s) => s.place?.id).filter(Boolean)).size,
    withPhotos: inPeriod.filter((s) => s.photoCount > 0).length,
    byPerson,
    categories,
    zones: zones.slice(0, 8),
    medianKm,
    alike,
    novelties,
    again: inPeriod
      .filter((s) => s.rating === 'again')
      .map((s) => ({ id: s.id, title: s.title, startDate: s.startDate, place: s.place?.name ?? null })),
    offTrack,
    alerts,
  };
}
