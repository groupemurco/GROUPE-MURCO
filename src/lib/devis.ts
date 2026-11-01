// Devis détaillé: une soumission rédigée (ouvrages visés, travaux inclus, prix forfaitaire, conditions)
// plutôt qu'une liste de lignes de prix. Module pur (testé avec node): pas de Dexie ici.

export interface DevisSection {
  title: string; // ex.: « Ouvertures visées »
  items: string[]; // un point par ligne
  countLabel?: string; // ex.: « ouvertures » → « Total : 15 ouvertures »
}

export interface Devis {
  heading: string; // ex.: « Soumission de calfeutrage »
  sections: DevisSection[]; // avant le prix
  priceLabel: string; // ex.: « Prix forfaitaire proposé »
  priceNote: string; // sous le prix
  conditions: string[]; // après le prix
  closing: string; // mot de la fin
}

/** Modèle enregistré par l'entrepreneur (réutilisable d'une soumission à l'autre). */
export interface SavedDevis {
  name: string;
  devis: Devis;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Point nettoyé (sans puce collée au début). */
export const cleanItem = (s: string) => s.replace(/^\s*(?:[•·\-*–—]|\d+[.)](?=\s))\s*/, '').trim();

export const devisItems = (items: string[]) => items.map(cleanItem).filter(Boolean);

/** « 5 fenêtres au sous-sol » compte pour 5, « Porte-patio » pour 1. */
export function itemCount(item: string): number {
  const m = cleanItem(item).match(/^(\d+(?:[.,]\d+)?)\s/);
  return m ? Number(m[1].replace(',', '.')) : 1;
}

export function sectionCount(sec: DevisSection): number {
  return devisItems(sec.items).reduce((a, it) => a + itemCount(it), 0);
}

/** « Total : 15 ouvertures » (rien si la section ne compte pas). */
export function sectionTotalText(sec: DevisSection): string {
  const label = sec.countLabel?.trim();
  if (!label) return '';
  const n = sectionCount(sec);
  return n ? `Total : ${String(r2(n)).replace('.', ',')} ${label}` : '';
}

/** Titre du document: « GROUPE MURCO — SOUMISSION DE CALFEUTRAGE ». */
export function devisTitle(company: string, d: Pick<Devis, 'heading'>): string {
  return [company.trim(), d.heading.trim()].filter(Boolean).join(' — ').toLocaleUpperCase('fr-CA');
}

/** Ligne de prix qui porte le montant (sert aux totaux, à la facture et aux rapports). */
export function devisLineDescription(d: Devis): string {
  const counted = d.sections.find((s) => s.countLabel?.trim() && sectionCount(s));
  const head = d.heading.trim().replace(/^soumission\s+(de\s+|d[’']|pour\s+)?/i, '') || 'Travaux';
  const what = head.charAt(0).toUpperCase() + head.slice(1);
  return `${what}${counted ? ` (${sectionTotalText(counted).replace(/^Total : /, '')})` : ''} — prix forfaitaire`;
}

/** Taxes comprises dans un prix « taxes incluses »: le total ne bouge pas, on en extrait la TPS et la TVQ. */
export function splitIncludedTaxes(gross: number, tpsRate: number, tvqRate: number, applyTps: boolean, applyTvq: boolean): { subtotal: number; tps: number; tvq: number } {
  const rate = (applyTps ? tpsRate : 0) + (applyTvq ? tvqRate : 0);
  const base = gross / (1 + rate / 100);
  const tps = applyTps ? r2((base * tpsRate) / 100) : 0;
  const tvq = applyTvq ? r2((base * tvqRate) / 100) : 0;
  return { subtotal: r2(gross - tps - tvq), tps, tvq };
}

const D = (heading: string, sections: DevisSection[], priceNote: string, conditions: string[], closing = 'Merci de votre confiance. Au plaisir de réaliser vos travaux!'): Devis => ({
  heading, sections, priceLabel: 'Prix forfaitaire proposé', priceNote, conditions, closing,
});

const COMMON_CONDITIONS = [
  'Le prix est établi à partir des dimensions et des renseignements fournis.',
  'Les travaux seront planifiés selon les disponibilités et les conditions météorologiques.',
];

/** Modèles de départ par métier (l'entrepreneur les modifie, puis peut enregistrer les siens). */
export const DEVIS_TEMPLATES: { key: string; label: string; devis: Devis }[] = [
  {
    key: 'calfeutrage', label: 'Calfeutrage',
    devis: D('Soumission de calfeutrage', [
      { title: 'Ouvertures visées', items: ['5 fenêtres au sous-sol', '8 fenêtres au rez-de-chaussée', '1 porte d’entrée', '1 porte-patio'], countLabel: 'ouvertures' },
      { title: 'Travaux inclus', items: [
        'Retrait complet des anciens joints de calfeutrage sur les ouvertures visées;',
        'Nettoyage et préparation des surfaces afin de favoriser l’adhérence;',
        'Application de nouveaux joints avec un scellant extérieur de qualité professionnelle, adapté aux matériaux en place;',
        'Finition soignée et nettoyage des résidus à la fin des travaux;',
        'Main-d’œuvre, matériaux et déplacement inclus.',
      ] },
    ], 'La couleur du scellant sera déterminée avec vous avant les travaux.', [
      COMMON_CONDITIONS[0],
      'Les réparations de cadres, de maçonnerie ou de revêtement, si nécessaires, ne sont pas incluses.',
      COMMON_CONDITIONS[1],
    ]),
  },
  {
    key: 'peinture', label: 'Peinture intérieure',
    devis: D('Soumission de peinture', [
      { title: 'Pièces visées', items: ['Salon', 'Cuisine', '2 chambres', '1 corridor'], countLabel: 'pièces' },
      { title: 'Travaux inclus', items: [
        'Protection des planchers, des meubles et des accessoires;',
        'Réparation des petites fissures et des trous de clous, sablage;',
        'Apprêt sur les réparations et aux endroits requis;',
        'Deux couches de peinture de qualité professionnelle sur les murs;',
        'Nettoyage complet à la fin des travaux;',
        'Main-d’œuvre, peinture et déplacement inclus.',
      ] },
    ], 'Les couleurs et le fini seront choisis avec vous avant les travaux.', [
      COMMON_CONDITIONS[0],
      'Les plafonds, les boiseries et les réparations majeures de gypse ne sont pas inclus, sauf si indiqué.',
      'Les petits objets et les effets personnels doivent être retirés des pièces avant notre arrivée.',
    ]),
  },
  {
    key: 'exterieur', label: 'Entretien extérieur',
    devis: D('Soumission d’entretien extérieur', [
      { title: 'Travaux visés', items: ['Nettoyage complet des gouttières', '18 fenêtres (lavage extérieur)', 'Lavage à pression de l’entrée'] },
      { title: 'Travaux inclus', items: [
        'Retrait des feuilles et des débris dans les gouttières et vérification des descentes pluviales;',
        'Lavage des vitres, des cadres et des moustiquaires à l’extérieur;',
        'Ramassage et disposition de tous les débris;',
        'Main-d’œuvre, équipement et déplacement inclus.',
      ] },
    ], 'Nous vous aviserons de toute réparation à prévoir constatée pendant les travaux.', [
      COMMON_CONDITIONS[0],
      'Les réparations de gouttières, de fascias ou de moustiquaires ne sont pas incluses.',
      COMMON_CONDITIONS[1],
    ]),
  },
  {
    key: 'deneigement', label: 'Déneigement (contrat de saison)',
    devis: D('Contrat de déneigement — saison 2026-2027', [
      { title: 'Surfaces visées', items: ['Entrée asphaltée (2 voitures)', 'Trottoir avant', 'Marches de l’entrée principale'] },
      { title: 'Services inclus', items: [
        'Déneigement à chaque chute de 5 cm et plus;',
        'Entrée dégagée avant 7 h les jours de semaine, autant que possible;',
        'Repoussage des bancs de neige au besoin;',
        'Installation et retrait des balises.',
      ] },
    ], 'Payable en deux versements égaux: au début du contrat et le 15 janvier.', [
      'Le contrat couvre la période du 15 novembre au 15 avril.',
      'Les dommages causés par des objets non balisés ou cachés sous la neige ne sont pas notre responsabilité.',
      'L’épandage d’abrasif n’est pas inclus, sauf si indiqué.',
    ], 'Merci de votre confiance. Bon hiver!'),
  },
  {
    key: 'paysagement', label: 'Entretien de terrain',
    devis: D('Soumission d’entretien de terrain — saison 2026', [
      { title: 'Services visés', items: ['Tonte hebdomadaire de la pelouse', 'Taille des haies (2 fois par saison)', 'Nettoyage du printemps et de l’automne'] },
      { title: 'Travaux inclus', items: [
        'Tonte, coupe des bordures et soufflage des surfaces dures;',
        'Ramassage et disposition des résidus de taille;',
        'Main-d’œuvre, équipement et déplacement inclus.',
      ] },
    ], 'Payable en versements mensuels de mai à octobre.', [
      'La saison va de la mi-mai à la fin d’octobre, selon la météo.',
      'Les engrais, la terre et les végétaux ne sont pas inclus, sauf si indiqué.',
    ]),
  },
  {
    key: 'menage', label: 'Ménage',
    devis: D('Soumission de ménage', [
      { title: 'Pièces visées', items: ['1 cuisine', '2 salles de bain', '3 chambres', '1 salon'], countLabel: 'pièces' },
      { title: 'Travaux inclus', items: [
        'Époussetage de toutes les surfaces accessibles;',
        'Nettoyage et désinfection de la cuisine et des salles de bain;',
        'Aspirateur et lavage des planchers;',
        'Produits et équipement inclus.',
      ] },
    ], 'Le lavage de l’intérieur des électroménagers peut être ajouté sur demande.', [
      'Le prix est établi selon la grandeur et l’état des lieux décrits.',
      'Un accès aux lieux, à l’eau et à l’électricité est requis.',
    ]),
  },
  {
    key: 'toiture', label: 'Toiture',
    devis: D('Soumission de toiture', [
      { title: 'Toiture visée', items: ['Versant avant et arrière (environ 18 carrés)', 'Pente moyenne, 1 cheminée, 2 évents'] },
      { title: 'Travaux inclus', items: [
        'Arrachage complet des bardeaux existants et disposition au conteneur;',
        'Inspection du pontage et remplacement des feuilles endommagées (jusqu’à 2 feuilles incluses);',
        'Membrane autocollante aux avant-toits et dans les noues, papier synthétique partout;',
        'Pose de bardeaux architecturaux, larmiers, solins et évents;',
        'Nettoyage du terrain et passage de l’aimant à clous.',
      ] },
    ], 'La couleur des bardeaux sera choisie avec vous avant les travaux.', [
      COMMON_CONDITIONS[0],
      'Le remplacement de pontage au-delà de 2 feuilles est facturé en supplément.',
      COMMON_CONDITIONS[1],
    ]),
  },
  {
    key: 'general', label: 'Général (tous métiers)',
    devis: D('Soumission de travaux', [
      { title: 'Travaux visés', items: ['Décris ici ce qui est visé (une ligne par élément)'] },
      { title: 'Travaux inclus', items: [
        'Préparation et protection des lieux;',
        'Réalisation des travaux selon les règles de l’art;',
        'Nettoyage à la fin des travaux;',
        'Main-d’œuvre, matériaux et déplacement inclus.',
      ] },
    ], '', [...COMMON_CONDITIONS]),
  },
];

/** Métier → modèle le plus proche. */
const TRADE_TO_TEMPLATE: Record<string, string> = {
  calfeutrage: 'calfeutrage', peinture: 'peinture', renovation: 'general', exterieur: 'exterieur', deneigement: 'deneigement',
  paysagement: 'paysagement', arboriculture: 'paysagement', piscine: 'paysagement', menage: 'menage', tapis: 'menage', toiture: 'toiture',
};

export function templateKeyFor(trades: string[]): string {
  for (const t of trades) if (TRADE_TO_TEMPLATE[t]) return TRADE_TO_TEMPLATE[t];
  return 'general';
}

const copy = (d: Devis): Devis => ({ ...d, sections: d.sections.map((s) => ({ ...s, items: [...s.items] })), conditions: [...d.conditions] });

export function devisFromTemplate(key: string, saved: SavedDevis[] = []): Devis {
  const own = saved.find((x) => `perso:${x.name}` === key);
  if (own) return copy(own.devis);
  return copy((DEVIS_TEMPLATES.find((x) => x.key === key) ?? DEVIS_TEMPLATES[DEVIS_TEMPLATES.length - 1]).devis);
}

/** Réponse de l'IA (JSON) → devis propre, sans champs inventés. */
export function devisFromJson(raw: unknown, fallback: Devis): { devis: Devis; price?: number; taxIncluded?: boolean; address?: string } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, d = '') => (typeof v === 'string' ? v.trim() : d);
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
  const sections = (Array.isArray(o.sections) ? o.sections : [])
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ title: str(x.titre ?? x.title), items: list(x.points ?? x.items), countLabel: str(x.compter ?? x.countLabel) || undefined }))
    .filter((x) => x.title || x.items.length);
  const price = Number(o.prix ?? o.price);
  return {
    devis: {
      heading: str(o.titre ?? o.heading, fallback.heading),
      sections: sections.length ? sections : fallback.sections,
      priceLabel: fallback.priceLabel,
      priceNote: str(o.note_prix ?? o.priceNote, fallback.priceNote),
      conditions: Array.isArray(o.conditions) ? list(o.conditions) : fallback.conditions,
      closing: str(o.mot_de_la_fin ?? o.closing, fallback.closing),
    },
    price: Number.isFinite(price) && price > 0 ? r2(price) : undefined,
    taxIncluded: typeof o.taxes_incluses === 'boolean' ? o.taxes_incluses : undefined,
    address: str(o.adresse) || undefined,
  };
}

/** Sans IA: « 5 fenêtres au sous-sol, 1 porte-patio, 1650 $ taxes incluses » → points de la 1re section, prix et taxes. */
export function devisFromText(text: string, base: Devis): { devis: Devis; price?: number; taxIncluded?: boolean } {
  const taxIncluded = /tax\w*\s+inclu/i.test(text) ? true : /(plus|\+)\s*(les\s+)?tax|avant\s+tax/i.test(text) ? false : undefined;
  const pm = text.match(/(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:\$|piasses?|dollars?)/i);
  const price = pm ? Number(pm[1].replace(/\s/g, '').replace(',', '.')) : undefined;
  const rest = (pm ? text.replace(pm[0], ' ') : text).replace(/(plus|\+)?\s*(les\s+)?tax\w*(\s+inclu\w*)?/gi, ' ');
  const parts = rest.split(/[\n,;]+|\s+et\s+/i).map((x) => x.trim().replace(/[.:]+$/, '')).filter((x) => x.length > 2);
  const devis = copy(base);
  if (parts.length) {
    const first = devis.sections[0] ?? { title: 'Travaux visés', items: [] };
    devis.sections = [{ ...first, items: parts.map((x) => x.charAt(0).toUpperCase() + x.slice(1)) }, ...devis.sections.slice(1)];
  }
  return { devis, price: price && price > 0 ? r2(price) : undefined, taxIncluded };
}
