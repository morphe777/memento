# Mémento — objectifs, projets, charge mentale

**Mémento** est le nom de l'application (interface, titres, PWA). Identifiant technique : `memento` (dépôt, packages, images Docker, base de données, hôte `memento.internal.lcl`).

Outil personnel, mono-utilisateur, auto-hébergé (homelab). Il organise ma vie en Domaines › Objectifs › Projets › Tâches, me propose chaque lundi un plan de semaine plafonné en heures, et produit des rapports figés. Il est piloté par IA (API + MCP) mais doit rester 100 % utilisable à la main.

## Lire dans cet ordre

1. `docs/02-dossier-dev.md` — **le document de travail** : architecture, stack, modèle de données, règles métier (RB-xx), moteur, rapports, API, MCP, pages, design system, plan par lots.
2. `docs/01-specs-fonctionnelles.md` — le pourquoi et le détail fonctionnel (IDs VIS, G, DM, CH, WF, R, V, F, NF). La section **9.0 « Décisions prises »** prime sur tout le reste.
3. `maquettes/README.md` puis les 4 fichiers `.dc.html` — référence visuelle et comportementale des écrans clés.

Priorité en cas de conflit : décisions datées (Specs §9.0) > dossier de dev > maquettes > reste des Specs.

## Règles de travail

- Développer **lot par lot** (dossier de dev §13). À la fin de chaque lot : tests verts, courte démo, puis **s'arrêter et attendre ma validation** avant le lot suivant.
- L'API est la seule porte d'entrée de la logique métier ; le front, le MCP et le worker passent par elle (F-26).
- Toute règle métier vit dans `packages/domain`, avec ses tests unitaires et son ID en commentaire.
- Interface en français ; code, noms de tables, endpoints et messages de commit en anglais.
- Si une règle manque ou est ambiguë : prendre l'option la plus simple, l'écrire dans `docs/DECISIONS.md` (date, contexte, choix) et me la signaler en fin de lot. Ne jamais inventer silencieusement une règle métier.
- Ne pas exposer de service sur Internet ; aucun secret dans le dépôt.
- Les décisions encore ouvertes sont listées en dossier de dev §14 : les valeurs proposées s'appliquent tant que je n'ai pas tranché.

## Démarrer

Commencer par le lot **L0 Socle**.
