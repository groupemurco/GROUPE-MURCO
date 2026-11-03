// Devis détaillé: une soumission rédigée (ouvrages visés, travaux inclus, prix forfaitaire, conditions)
// plutôt qu'une liste de lignes de prix. Module pur (testé avec node): pas de Dexie ici.
import type { LineItem } from './db';

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
      { title: 'Ouvertures visées', items: [], countLabel: 'ouvertures' },
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
      { title: 'Pièces visées', items: [], countLabel: 'pièces' },
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
      { title: 'Travaux visés', items: [] },
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
      { title: 'Surfaces visées', items: [] },
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
      { title: 'Services visés', items: [] },
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
      { title: 'Pièces visées', items: [], countLabel: 'pièces' },
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
      { title: 'Toiture visée', items: [] },
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
      { title: 'Travaux visés', items: [] },
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

/** Devis vide: l'assistant (ou l'entrepreneur) le remplit selon la demande du client. */
export function blankDevis(): Devis {
  return {
    heading: '',
    sections: [{ title: 'Travaux visés', items: [] }, { title: 'Travaux inclus', items: [] }],
    priceLabel: 'Prix forfaitaire proposé',
    priceNote: '',
    conditions: [],
    closing: 'Merci de votre confiance. Au plaisir de réaliser vos travaux!',
  };
}

/** Rien d'écrit encore (on offre alors l'assistant en premier). */
export const isDevisEmpty = (d: Devis) => !d.heading.trim() && d.sections.every((s) => !devisItems(s.items).length) && !devisItems(d.conditions).length;

const copy = (d: Devis): Devis => ({ ...d, sections: d.sections.map((s) => ({ ...s, items: [...s.items] })), conditions: [...d.conditions] });

export function devisFromTemplate(key: string, saved: SavedDevis[] = []): Devis {
  const own = saved.find((x) => `perso:${x.name}` === key);
  if (own) return copy(own.devis);
  return copy((DEVIS_TEMPLATES.find((x) => x.key === key) ?? DEVIS_TEMPLATES[DEVIS_TEMPLATES.length - 1]).devis);
}

/** Réponse de l'IA (JSON) → devis propre, sans champs inventés. */
export interface DevisContact {
  name?: string;
  contact?: string;
  email?: string;
  phone?: string;
  address?: string;
}

/** Estimation du prix (pour l'entrepreneur seulement, jamais sur le devis): lignes avec ses propres prix. */
export interface DevisEstimate {
  lines: LineItem[];
  note: string; // hypothèses de l'assistant (quantités supposées…)
}

/** Un prix de la liste de l'entreprise (codes et prix). */
export interface PriceRef {
  code: string;
  name: string;
  unit: string;
  price: number;
  minimum?: number;
}

const lineTotal = (it: Pick<LineItem, 'quantity' | 'unitPrice' | 'minimum'>) => {
  const raw = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
  return r2(it.quantity > 0 && it.minimum && raw < it.minimum ? it.minimum : raw);
};
export const estimateTotal = (lines: LineItem[]) => r2(lines.reduce((a, it) => a + lineTotal(it), 0));

/** Prix forfaitaire proposé à partir de l'estimation (avant taxes): taxes ajoutées si le prix les inclut, arrondi aux 5 $. */
export function priceFromEstimate(total: number, o: { taxIncluded?: boolean; taxed: boolean; tpsRate: number; tvqRate: number }): number {
  const gross = o.taxIncluded && o.taxed ? total * (1 + (o.tpsRate + o.tvqRate) / 100) : total;
  return gross > 0 ? Math.ceil(r2(gross) / 5) * 5 : 0;
}

/** Lignes de l'IA → lignes avec MES prix quand le code existe (on ne se fie pas au prix inventé). */
export function estimateFromJson(raw: unknown, prices: PriceRef[]): DevisEstimate | undefined {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(o.estimation) ? o.estimation : [];
  const lines: LineItem[] = list
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .map((x) => {
      const code = String(x.code ?? '').trim().toUpperCase();
      const ref = code ? prices.find((p) => p.code.toUpperCase() === code) : undefined;
      const qty = Number(x.quantite);
      const unitPrice = ref ? ref.price : Number(x.prix_unitaire);
      return {
        code: ref ? ref.code : '',
        description: String(x.description ?? '').trim() || ref?.name || '',
        unit: ref?.unit ?? (String(x.unite ?? '').trim() || 'unité'),
        quantity: Number.isFinite(qty) && qty > 0 ? r2(qty) : 1,
        unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? r2(unitPrice) : 0,
        ...(ref?.minimum ? { minimum: ref.minimum } : {}),
      };
    })
    .filter((x) => x.description && x.unitPrice > 0);
  if (!lines.length) return undefined;
  return { lines, note: typeof o.explication_prix === 'string' ? o.explication_prix.trim() : '' };
}

export interface DevisDraft {
  devis: Devis;
  price?: number;
  taxIncluded?: boolean;
  address?: string; // adresse des travaux
  client?: DevisContact; // coordonnées trouvées dans le courriel
  fromClient?: boolean; // le texte est un message du client (gardé dans sa conversation)
  questions?: string[]; // ce qui manque pour bien chiffrer
  estimate?: DevisEstimate; // prix estimé avec les prix de l'entreprise
}

export function devisFromJson(raw: unknown, fallback: Devis, prices: PriceRef[] = []): DevisDraft {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, d = '') => (typeof v === 'string' ? v.trim() : d);
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
  const sections = (Array.isArray(o.sections) ? o.sections : [])
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ title: str(x.titre ?? x.title), items: list(x.points ?? x.items), countLabel: str(x.compter ?? x.countLabel) || undefined }))
    .filter((x) => x.title || x.items.length);
  const price = Number(o.prix ?? o.price);
  const c = (o.client && typeof o.client === 'object' ? o.client : {}) as Record<string, unknown>;
  const client: DevisContact = { name: str(c.nom) || undefined, contact: str(c.contact) || undefined, email: str(c.courriel).toLowerCase() || undefined, phone: str(c.telephone) || undefined, address: str(c.adresse) || undefined };
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
    client: Object.values(client).some(Boolean) ? client : undefined,
    fromClient: o.courriel_client === true,
    questions: list(o.questions),
    estimate: estimateFromJson(raw, prices),
  };
}

const STREET = '(?:rue|avenue|av\\.?|boulevard|boul\\.?|chemin|ch\\.|rang|route|rte|place|montée|croissant|impasse|terrasse|allée|promenade|côte)';
const CITY = "[A-ZÉÈÂÎ][\\wéèêëàâîïôöùûüç'’-]*(?:[ -](?:[A-ZÉÈÂÎ][\\wéèêëàâîïôöùûüç'’-]*|de|du|des|sur|la|le))*";
const ADDRESS = new RegExp(`\\b\\d{1,6}\\s*,?\\s+${STREET}\\s+[^,.\\n]+?(?=\\s*(?:,|\\.|\\n|$|\\s(?:à|a|au)\\s))(?:\\s*,?\\s*(?:à|a|au)?\\s*(${CITY}))?(?:,?\\s*(?:QC|Qc|Québec))?(?:,?\\s*[A-Z]\\d[A-Z]\\s?\\d[A-Z]\\d)?`, 'i');

/** Sans IA: courriel, téléphone, adresse et nom repérés dans le texte (sauf les tiens). */
export function contactFromText(text: string, own: { email?: string; phone?: string } = {}): DevisContact {
  const digits = (x?: string) => (x ?? '').replace(/\D/g, '').slice(-10);
  const email = (text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []).map((x) => x.toLowerCase()).find((x) => x !== own.email?.toLowerCase());
  const phones = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? [];
  const phone = phones.map((x) => x.trim()).find((x) => !own.phone || digits(x) !== digits(own.phone));
  const senders = [...text.matchAll(/^(?:De|From)\s*:\s*"?([^"<\n]+?)"?\s*<([^>\s]+)>/gim)].filter((m) => m[2].toLowerCase() !== own.email?.toLowerCase());
  const a = text.match(ADDRESS);
  const address = a ? a[0].replace(/\s*,?\s+à\s+/i, ', ').replace(/\s+/g, ' ').trim() : undefined;
  // Une phrase qui commence par le nom: « Denise Tremblay 819 555-0101, … » ou « Pour Denise Tremblay, … »
  const lead = text.replace(/^\s*(?:pour|client(?:e)?\s*:?|chez)\s+/i, '').split(/[,\n:;]|\d/)[0].trim();
  const W = "[A-ZÉÈÂÎ][\\wéèêëàâîïôöùûüç'’-]+";
  const nameLike = new RegExp(`^(?:(?:M\\.|Mme|Monsieur|Madame)\\s+)?${W}(?:\\s+${W}){0,3}$`).test(lead) ? lead : undefined;
  // « … chez Marc Lévesque », « … pour Mme Roy »
  const after = text.match(new RegExp(`\\b(?:chez|pour|client(?:e)?\\s*:)\\s+((?:(?:M\\.|Mme)\\s+)?${W}(?:\\s+${W}){1,3})`))?.[1];
  return { name: senders[0]?.[1]?.trim() ?? nameLike ?? after, email: senders[0]?.[2]?.toLowerCase() ?? email, phone, ...(address ? { address } : {}) };
}

/** Le texte sans les coordonnées (pour en faire les points du devis sans IA). */
export function withoutContact(text: string, c: DevisContact): string {
  let t = text;
  for (const x of [c.email, c.phone, c.name]) if (x) t = t.split(x).join(' ');
  const a = t.match(ADDRESS);
  if (a) t = t.replace(a[0], ' ');
  if (c.name) t = t.replace(/\b(?:chez|pour)\s*(?=[,.;:\n]|$)/gi, ' ');
  return t
    .replace(/^\s*(?:pour|chez)\b/i, ' ')
    .split(/[\n.;:]+/)
    .map((x) => x.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, ''))
    .filter(Boolean)
    .join('. ');
}

/** Sans IA: le modèle selon les mots de la demande (calfeutrage, peinture, gouttières…). */
export function templateKeyForText(text: string): string | undefined {
  const t = text.toLowerCase();
  const map: [RegExp, string][] = [
    [/calfeutr|scellant|joints?\b|mastic/, 'calfeutrage'], [/peintur|peinturer|repeind|teintur/, 'peinture'], [/toit|bardeau|toiture/, 'toiture'],
    [/d[ée]neig|neige/, 'deneigement'], [/goutti[èe]re|vitres?\b|lavage|pression/, 'exterieur'], [/tonte|gazon|pelouse|haies?\b|terrain/, 'paysagement'],
    [/m[ée]nage|nettoyage/, 'menage'],
  ];
  return map.find(([re]) => re.test(t))?.[1];
}

/** Sans IA: « 5 fenêtres au sous-sol, 1 porte-patio, 1650 $ taxes incluses » → points de la 1re section, prix et taxes. */
export function devisFromText(text: string, base: Devis): { devis: Devis; price?: number; taxIncluded?: boolean } {
  const taxIncluded = /tax\w*\s+inclu/i.test(text) ? true : /(plus|\+)\s*(les\s+)?tax|avant\s+tax/i.test(text) ? false : undefined;
  const pm = text.match(/(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:\$|piasses?|dollars?)/i);
  const price = pm ? Number(pm[1].replace(/\s/g, '').replace(',', '.')) : undefined;
  const rest = (pm ? text.replace(pm[0], ' ') : text).replace(/(plus|\+)?\s*(les\s+)?tax\w*(\s+inclu\w*)?/gi, ' ');
  // « Calfeutrage de 6 fenêtres » → « 6 fenêtres » (le type de job est déjà dans le titre)
  const parts = rest.split(/[\n,;.]+|\s+et\s+/i).map((x) => x.trim().replace(/[.:]+$/, '').replace(/^[^\d,]{3,40}?\s+(?:de|des|d[’'])\s*(?=\d)/i, '')).filter((x) => x.length > 2);
  const devis = copy(base);
  if (parts.length) {
    const first = devis.sections[0] ?? { title: 'Travaux visés', items: [] };
    devis.sections = [{ ...first, items: parts.map((x) => x.charAt(0).toUpperCase() + x.slice(1)) }, ...devis.sections.slice(1)];
  }
  return { devis, price: price && price > 0 ? r2(price) : undefined, taxIncluded };
}
