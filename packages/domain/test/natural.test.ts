import { describe, expect, it } from 'vitest';
import { parseTaskText, roundDuration } from '../src/rules/natural.ts';

// Wednesday 4 November 2026.
const today = '2026-11-04';
const domains = [
  { id: 'd-sante', name: 'Santé' },
  { id: 'd-maison', name: 'Maison' },
  { id: 'd-amis', name: 'Amis & Social' },
];
const p = (text: string, more: Partial<Parameters<typeof parseTaskText>[1]> = {}) =>
  parseTaskText(text, { today, domains, ...more });

describe('D-115 natural task text', () => {
  it.each([
    ["Appeler le garage aujourd'hui", 'Appeler le garage', '2026-11-04'],
    ['Appeler le garage demain', 'Appeler le garage', '2026-11-05'],
    ['Payer la cantine après-demain', 'Payer la cantine', '2026-11-06'],
    ['Rendre le livre dans 3 jours', 'Rendre le livre', '2026-11-07'],
    ['Rendre le livre dans deux semaines', 'Rendre le livre', '2026-11-18'],
    ['Faire le dossier pour le 14 novembre', 'Faire le dossier', '2026-11-14'],
    ['Faire le dossier le 14', 'Faire le dossier', '2026-11-14'],
    ['Faire le dossier le 2', 'Faire le dossier', '2026-12-02'],
    ['Anniversaire Léa 3 mars', 'Anniversaire Léa', '2027-03-03'],
    ['Déclaration 15/05/2027', 'Déclaration', '2027-05-15'],
    ['Déclaration le 1er décembre', 'Déclaration', '2026-12-01'],
    ['Courses vendredi', 'Courses', '2026-11-06'],
    ['Courses mercredi', 'Courses', '2026-11-11'], // said on a Wednesday: next one (user choice)
    ['Courses lundi prochain', 'Courses', '2026-11-09'],
    ['Ranger la cave ce week-end', 'Ranger la cave', '2026-11-07'],
    ['Bilan fin du mois', 'Bilan', '2026-11-30'],
    ['Bilan la semaine prochaine', 'Bilan', '2026-11-15'],
    ['Bilan d’ici lundi 16 novembre', 'Bilan', '2026-11-16'],
  ])('%s', (text, title, due) => {
    const r = p(text);
    expect(r.title).toBe(title);
    expect(r.dueDate).toBe(due);
    expect(r.recurrenceRule).toBeNull();
  });

  it('a written date wins over a relative one, the gap is flagged', () => {
    const r = p('Faire X demain le 14 novembre');
    expect(r.title).toBe('Faire X');
    expect(r.dueDate).toBe('2026-11-14');
    expect(r.parts[0].warning).toMatch(/demain/);
  });

  it('a lone number is not a date', () => {
    expect(p('Acheter 3 pommes').dueDate).toBeNull();
    expect(p('Acheter 3 pommes').title).toBe('Acheter 3 pommes');
  });

  it.each([
    ['Méditer tous les jours', 'Méditer', 'FREQ=DAILY', '2026-11-04'],
    ['Sortir les poubelles tous les mardis', 'Sortir les poubelles', 'FREQ=WEEKLY;BYDAY=TU', '2026-11-10'],
    ['Sport chaque lundi et jeudi', 'Sport', 'FREQ=WEEKLY;BYDAY=MO,TH', '2026-11-05'],
    ['Sport les mercredis', 'Sport', 'FREQ=WEEKLY;BYDAY=WE', '2026-11-04'],
    ['Arroser toutes les 2 semaines', 'Arroser', 'FREQ=WEEKLY;INTERVAL=2', '2026-11-04'],
    ['Courrier chaque semaine', 'Courrier', 'FREQ=WEEKLY', '2026-11-04'],
    ['Loyer chaque mois le 5', 'Loyer', 'FREQ=MONTHLY;BYMONTHDAY=5', '2026-11-05'],
    ['Loyer le 1er de chaque mois', 'Loyer', 'FREQ=MONTHLY;BYMONTHDAY=1', '2026-12-01'],
    ['Relevés tous les 3 mois', 'Relevés', 'FREQ=MONTHLY;INTERVAL=3', '2026-11-04'],
    ['Bilan chaque trimestre', 'Bilan', 'FREQ=MONTHLY;INTERVAL=3', '2026-11-04'],
    ['Mails en semaine', 'Mails', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-11-04'],
    ['Fête chaque année le 14 novembre', 'Fête', 'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=14', '2026-11-14'],
    ['Assurance tous les 2 janvier', 'Assurance', 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=2', '2027-01-02'],
    ['Courrier chaque semaine à partir du 20 novembre', 'Courrier', 'FREQ=WEEKLY', '2026-11-20'],
  ])('%s', (text, title, rule, first) => {
    const r = p(text);
    expect(r.title).toBe(title);
    expect(r.recurrenceRule).toBe(rule);
    expect(r.dueDate).toBe(first);
  });

  it('no recurrence, domain or week for a project task', () => {
    const r = p('Sport tous les mardis cette semaine #sante', { inbox: false });
    expect(r.recurrenceRule).toBeNull();
    expect(r.domainId).toBeNull();
    expect(r.week).toBe(false);
  });

  it.each([
    ['Appeler maman 15 min', 15, undefined],
    ['Appeler maman 1h', 60, undefined],
    ['Appeler maman (1 h 30)', 120, /arrondi/],
    ['Appeler maman une demi-heure', 30, undefined],
    ['Appeler maman 20 minutes', 15, /arrondi/],
    ['Déménager 4h', 120, /2 h max/],
  ])('%s', (text, min, warning) => {
    const r = p(text);
    expect(r.title).toMatch(/^(Appeler maman|Déménager)$/);
    expect(r.durationMin).toBe(min);
    if (warning) expect(r.parts.find((x) => x.kind === 'duration')?.warning).toMatch(warning);
  });

  it('a time of day is not a duration', () => {
    const r = p('Dentiste demain à 14h');
    expect(r.durationMin).toBeNull();
    expect(r.title).toBe('Dentiste à 14h');
  });

  it('domain by #tag, accents and partial names', () => {
    expect(p('Prise de sang #santé').domainId).toBe('d-sante');
    expect(p('Prise de sang #sante').domainId).toBe('d-sante');
    expect(p('Dîner #amis').domainId).toBe('d-amis');
    expect(p('Dîner #amis').title).toBe('Dîner');
    const unknown = p('Dîner #boulot');
    expect(unknown.domainId).toBeNull();
    expect(unknown.title).toBe('Dîner #boulot');
    expect(unknown.parts[0].warning).toMatch(/inconnu/);
  });

  it('« cette semaine » is the week plan, not a deadline', () => {
    const r = p('Réparer le vélo cette semaine');
    expect(r.week).toBe(true);
    expect(r.dueDate).toBeNull();
    expect(r.title).toBe('Réparer le vélo');
  });

  it('quoted text is kept as typed', () => {
    const r = p('Préparer "la réunion de lundi" demain');
    expect(r.title).toBe('Préparer la réunion de lundi');
    expect(r.dueDate).toBe('2026-11-05');
  });

  it('an undone kind keeps its words and is not read as something else', () => {
    const r = p('Sport chaque lundi', { ignore: ['recurrence'] });
    expect(r.title).toBe('Sport chaque lundi');
    expect(r.recurrenceRule).toBeNull();
    expect(r.dueDate).toBeNull();
  });

  it('all together', () => {
    const r = p('Acheter du pain demain 15 min #maison');
    expect(r).toMatchObject({
      title: 'Acheter du pain',
      dueDate: '2026-11-05',
      durationMin: 15,
      domainId: 'd-maison',
    });
    expect(r.parts.map((x) => x.kind).sort()).toEqual(['date', 'domain', 'duration']);
  });

  it('RB-03 rounding', () => {
    expect([1, 10, 22, 45, 90, 300].map(roundDuration)).toEqual([5, 15, 15, 60, 120, 120]);
  });
});
