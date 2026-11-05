// Assistant IA: Gemini Flash via Firebase AI Logic (pas de clé à gérer, pas de serveur à nous).
// L'IA comprend la phrase, cherche le client, pose les questions qui manquent, puis PROPOSE:
// rien n'est créé sans que l'utilisateur confirme dans l'app.
import { getAI, getGenerativeModel, VertexAIBackend, Schema, type ChatSession, type FunctionCall, type FunctionDeclaration, type Part } from 'firebase/ai';
import type { Intent, IntentKind } from './assistant';
import { devisFromJson, type Devis, type DevisDraft, type PriceRef } from './devis';
import { findClients } from './fuzzy';
import { db } from './db';
import { firebaseApp, getFirebaseConfig } from './sync';
import { docTotals } from './utils';

export { findClients };

/** Modèles essayés dans l'ordre (le premier qui existe pour le projet). */
// Le dernier (« lite ») a la plus grande limite gratuite: il prend le relais quand les autres sont à bout.
export const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

/** Délai max d'une réponse de l'IA: sans ça, une connexion bloquée (app mobile) attend sans fin. */
export const AI_TIMEOUT_MS = 20000;

export interface AiClient { id?: number; name: string; address: string; phone: string }
export interface AiService { code: string; name: string; unit: string; price: number }

export interface AiDoc {
  type: 'facture' | 'soumission' | 'job' | 'visite';
  clientId?: number;
  name?: string; // nouveau client
  phone?: string;
  address?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  lines: { code?: string; description?: string; quantity: number; unitPrice?: number }[];
}
export interface AiOrder {
  supplier?: string;
  items: { description: string; qty: number; unit: string }[];
  clientId?: number;
  neededBy?: string;
}
/** Changement à apporter à la fiche d'un client (seulement les champs dits). */
export interface AiClientEdit {
  clientId: number;
  name?: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}
/** Message écrit par l'IA pour un client (relance, rappel, confirmation…): le patron le relit et l'envoie. */
export interface AiMessage {
  clientId: number;
  text: string;
  channel?: 'texto' | 'courriel';
  subject?: string;
}
export type AiResult =
  | { kind: 'message'; message: AiMessage; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'order'; order: AiOrder; text: string }
  | { kind: 'doc'; doc: AiDoc; text: string }
  | { kind: 'client'; edit: AiClientEdit; text: string }
  | { kind: 'intent'; intent: Intent; text: string };

/** Appel de modifier_client → changement à confirmer (null si le client ou les champs manquent). */
export function toClientEdit(a: Record<string, unknown>): AiClientEdit | null {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const edit: AiClientEdit = { clientId: Number(a.client_id), name: str(a.nom), contact: str(a.contact), phone: str(a.telephone), email: str(a.courriel), address: str(a.adresse), notes: str(a.notes) };
  if (!Number.isFinite(edit.clientId)) return null;
  return Object.entries(edit).some(([k, v]) => k !== 'clientId' && v !== undefined) ? edit : null;
}

/** Appel de ecrire_message → message à relire et envoyer (null si le client ou le texte manquent). */
export function toMessage(a: Record<string, unknown>): AiMessage | null {
  const text = typeof a.texte === 'string' ? a.texte.trim() : '';
  const clientId = Number(a.client_id);
  if (!text || !Number.isFinite(clientId)) return null;
  const channel = a.canal === 'courriel' ? 'courriel' : a.canal === 'texto' ? 'texto' : undefined;
  return { clientId, text, channel, subject: typeof a.sujet === 'string' && a.sujet.trim() ? a.sujet.trim() : undefined };
}

const STATUT_JOB: Record<string, string> = { planifie: 'planifiée', fait: 'faite (à facturer)', facture: 'facturée', annule: 'annulée' };
const STATUT_DOC: Record<string, string> = { draft: 'brouillon', sent: 'envoyée', paid: 'payée', partial: 'paiement partiel', accepted: 'acceptée', refused: 'refusée', cancelled: 'annulée' };

/** Ce que l'app sait déjà d'un client: ses jobs à l'agenda, ses soumissions et ses factures. */
export async function clientDossier(clientId: number) {
  try {
    const [jobs, docs] = await Promise.all([db.jobs.where('clientId').equals(clientId).toArray(), db.docs.where('clientId').equals(clientId).toArray()]);
    return {
      jobs_agenda: jobs.filter((j) => j.status !== 'annule').sort((x, y) => y.date.localeCompare(x.date)).slice(0, 8).map((j) => ({ date: j.date, heure: j.time || undefined, titre: j.title || undefined, statut: STATUT_JOB[j.status] ?? j.status, adresse: j.address || undefined, travaux: j.items.map((i) => i.description).filter(Boolean).slice(0, 5) })),
      documents: docs.sort((x, y) => y.date.localeCompare(x.date)).slice(0, 8).map((d) => { const t = docTotals(d, { tpsRate: 5, tvqRate: 9.975 }); return { type: d.type === 'invoice' ? 'facture' : 'soumission', numero: d.number, date: d.date, titre: d.title || undefined, statut: STATUT_DOC[d.status] ?? d.status, total: t.total, solde: t.balance }; }),
    };
  } catch {
    return {};
  }
}

/** Réponse de chercher_client: les clients qui ressemblent + leur dossier (pour ne pas redemander ce qui est déjà inscrit). */
export async function lookupClients(nom: string, all: AiClient[]) {
  return Promise.all(findClients(nom, all).slice(0, 4).map(async (x) => ({ id: x.id, nom: x.name, adresse: x.address || '', telephone: x.phone || '', ...(x.id ? await clientDossier(x.id) : {}) })));
}

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'chercher_client',
    description: 'Cherche un client existant par son nom (la dictée peut mal écrire le nom: le résultat tolère les fautes). À utiliser dès qu’un nom de client est dit.',
    parameters: Schema.object({ properties: { nom: Schema.string({ description: 'Nom ou partie du nom, tel qu’entendu' }) } }),
  },
  {
    name: 'preparer_document',
    description: 'Prépare une facture, une soumission, une job planifiée ou une visite d’estimation. L’app affiche un résumé que l’utilisateur confirme: appelle-la quand tu as l’essentiel.',
    parameters: Schema.object({
      properties: {
        type: Schema.enumString({ enum: ['facture', 'soumission', 'job', 'visite'], description: 'facture = travaux faits à facturer; soumission = prix à envoyer; job = travaux planifiés à une date (avec soumission); visite = aller voir avant de faire la soumission' }),
        client_id: Schema.number({ description: 'id d’un client trouvé avec chercher_client' }),
        nouveau_client_nom: Schema.string({ description: 'Nom complet si c’est un nouveau client' }),
        telephone: Schema.string(),
        adresse: Schema.string({ description: 'Adresse des travaux (numéro, rue, ville)' }),
        date: Schema.string({ description: 'YYYY-MM-DD' }),
        heure: Schema.string({ description: 'HH:MM, 24 h' }),
        lignes: Schema.array({
          items: Schema.object({
            properties: {
              code: Schema.string({ description: 'Code du service de la liste de prix' }),
              description: Schema.string({ description: 'Seulement si aucun code ne correspond' }),
              quantite: Schema.number(),
              prix_unitaire: Schema.number({ description: 'Seulement si l’utilisateur a dit un prix' }),
            },
            optionalProperties: ['code', 'description', 'prix_unitaire'],
          }),
        }),
      },
      optionalProperties: ['client_id', 'nouveau_client_nom', 'telephone', 'adresse', 'date', 'heure'],
    }),
  },
  {
    name: 'modifier_client',
    description: 'Modifie la fiche d’un client existant (corriger son nom, téléphone, courriel, adresse, contact ou notes). Cherche-le d’abord avec chercher_client. Ne mets que ce qui change. L’app affiche le changement pour confirmation.',
    parameters: Schema.object({
      properties: {
        client_id: Schema.number({ description: 'id du client trouvé avec chercher_client' }),
        nom: Schema.string({ description: 'Nouveau nom complet' }),
        contact: Schema.string({ description: 'Personne contact' }),
        telephone: Schema.string(),
        courriel: Schema.string(),
        adresse: Schema.string({ description: 'Nouvelle adresse (numéro, rue, ville)' }),
        notes: Schema.string({ description: 'Notes (code de porte, chien…): remplace les notes actuelles' }),
      },
      optionalProperties: ['nom', 'contact', 'telephone', 'courriel', 'adresse', 'notes'],
    }),
  },
  {
    name: 'ecrire_message',
    description: 'Écrit un message à un client (relance de facture ou de soumission, rappel de rendez-vous, confirmation, remerciement…). Cherche-le d’abord avec chercher_client. Rédige le message complet, prêt à envoyer, signé par l’entreprise. L’app l’affiche pour que le patron le relise, le change et l’envoie.',
    parameters: Schema.object({
      properties: {
        client_id: Schema.number({ description: 'id du client trouvé avec chercher_client' }),
        texte: Schema.string({ description: 'Le message complet, poli, en français du Québec' }),
        canal: Schema.string({ description: 'texto ou courriel (texto par défaut si le client a un téléphone)' }),
        sujet: Schema.string({ description: 'Objet du courriel (si courriel)' }),
      },
      optionalProperties: ['canal', 'sujet'],
    }),
  },
  {
    name: 'commander_fournisseur',
    description: 'Prépare une commande de matériaux au fournisseur (ex.: « commande 3 gallons de blanc chez Rona pour jeudi »). L’app l’affiche pour qu’il l’envoie par texto ou courriel.',
    parameters: Schema.object({
      properties: {
        fournisseur: Schema.string({ description: 'Nom du magasin ou fournisseur' }),
        articles: Schema.array({
          items: Schema.object({
            properties: {
              description: Schema.string({ description: 'Article (produit, couleur, format)' }),
              quantite: Schema.number(),
              unite: Schema.string({ description: 'gallon, boîte, sac, feuille, unité…' }),
            },
          }),
        }),
        client_id: Schema.number({ description: 'Client de la job, si dit' }),
        date: Schema.string({ description: 'Pour quand, YYYY-MM-DD' }),
      },
      optionalProperties: ['fournisseur', 'client_id', 'date'],
    }),
  },
  {
    name: 'commande_rapide',
    description: 'Autres demandes: facture payée, relance, dépense, déplacer une job, job terminée, combien j’ai fait, mon horaire, ma liste à faire, facturer une job déjà planifiée.',
    parameters: Schema.object({
      properties: {
        action: Schema.enumString({ enum: ['payee', 'relancer', 'depense', 'deplacer', 'fini', 'combien', 'horaire', 'afaire', 'facturer_job'] }),
        client_id: Schema.number(),
        date: Schema.string({ description: 'YYYY-MM-DD' }),
        heure: Schema.string({ description: 'HH:MM' }),
        montant: Schema.number(),
        mode_paiement: Schema.enumString({ enum: ['Comptant', 'Virement Interac', 'Chèque', 'Carte'] }),
        categorie: Schema.string({ description: 'Dépense: Essence, Matériaux, Outils et équipement, Entretien véhicule, Repas, Location équipement, Sous-traitance, Téléphone / Internet, Publicité, Autre' }),
        fournisseur: Schema.string(),
        periode: Schema.enumString({ enum: ['jour', 'semaine', 'mois', 'annee'] }),
      },
      optionalProperties: ['client_id', 'date', 'heure', 'montant', 'mode_paiement', 'categorie', 'fournisseur', 'periode'],
    }),
  },
];

export function systemPrompt(company: string, services: AiService[], today: string): string {
  const d = new Date(today + 'T12:00:00');
  const day = d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const list = services.map((s) => `${s.code}: ${s.name} (${s.price} $ / ${s.unit})`).join('\n');
  return `Tu es Léa, l’agente administrative de ${company || 'l’entreprise'}, une entreprise de services au Québec. Tu fais tout le travail de bureau (soumissions, factures, relances, horaire, clients, commandes) et tu réponds à toute question liée à l’application. Le patron te parle en conduisant ou sur un chantier, souvent à voix (la dictée fait des fautes: devine le sens).
Aujourd’hui: ${day} (${today}).

Ta job: comprendre ce qu’il veut et le préparer avec les fonctions. Il confirme toujours dans l’app avant que ce soit créé.
- Un nom de client est dit: appelle chercher_client. Le résultat contient son DOSSIER (jobs à l’agenda, soumissions, factures, adresse): LIS-LE avant de poser une question. Si la job, l’adresse ou les travaux y sont déjà, ne les redemande JAMAIS: utilise-les (« Je vois la job de Thibault lundi au 618 Chateaubriand… ») et passe à l’action. Ne demande que ce qui manque vraiment.
- Tu connais ce qui est déjà planifié: ne recrée pas une job qui existe déjà à l’agenda, propose plutôt de la modifier, la déplacer ou la facturer.
- Tu as déjà posé une question et le patron répond: il parle de CE sujet, relie sa réponse à ta question et au dossier. Un seul résultat qui ressemble: c’est lui. Plusieurs: demande lequel (nomme-les). Aucun: c’est un nouveau client.
- Facture: il faut le client et les travaux. Soumission: client, adresse, travaux. Job: client, adresse, travaux, date. Visite: client, adresse, date.
- Pose UNE seule question courte à la fois pour ce qui manque. Pas besoin de l’heure ni du téléphone s’il ne les dit pas.
- Travaux: utilise les codes de la liste de prix. Quantités en nombres (pieds, fenêtres, heures…). N’invente jamais de prix.
- Dates: convertis « demain », « mardi », « le 14 » en YYYY-MM-DD (dans le futur).
- Des matériaux à acheter (« commande », « faut que j’achète », « appelle le fournisseur »): appelle commander_fournisseur.
- Dès que tu as l’essentiel, appelle preparer_document (ou commande_rapide pour le reste) sans redemander de confirmation.
- Tu es AUSSI une assistante personnelle complète, pas seulement pour les factures: réponds directement à toute question (calcul de quantités de matériaux comme la peinture, le béton, les bardeaux, conversions, prix approximatifs, conseils de métier, idées, rédaction de messages). Donne le résultat tout de suite avec tes hypothèses courantes (ex.: un gallon de peinture couvre environ 350 pi², compte 2 couches; arrondis à l’achat), sans demander la permission. Ne refuse jamais une demande ordinaire.
- « Planifie-moi telle job tel jour »: preparer_document type job (travaux + date). « Je dois aller faire une estimation / voir ça à telle adresse »: preparer_document type visite (client, adresse, date). Une soumission à envoyer: type soumission.
- Un message à envoyer à un client (« relance Girard pour sa facture », « écris à Roy que je passe demain »): chercher_client puis ecrire_message avec le texte complet. Pour une facture impayée, utilise ce que tu sais (montant, numéro) seulement s’il te l’a dit; sinon reste général et poli.
- Une PHOTO envoyée: un reçu ou une facture de fournisseur → commande_rapide action depense (montant total, fournisseur, catégorie, date si lisible); un courriel ou une demande de client → preparer_document type soumission (client, adresse, travaux); une photo de chantier → décris ce que tu vois et propose la suite.
- Corriger ou changer un client (nom, téléphone, courriel, adresse, notes): chercher_client puis modifier_client avec seulement ce qui change.
- Si on te demande une action de l’app que tu n’as pas (ex.: supprimer une fiche), dis-le simplement et propose l’étape la plus proche.
- NE RÉPÈTE JAMAIS ce que le patron vient de dire (« tu veux planifier une job pour Roy jeudi? » est interdit): passe directement à l’action (appelle la fonction) ou pose la seule question qui manque. Pas de reformulation, pas de « je comprends que… ».
- Réponds en français du Québec, court (une à trois phrases), sans liste ni markdown: tes réponses sont lues à voix haute.

Liste de prix:
${list}`;
}

export function aiConfigured(enabled?: boolean): boolean {
  return enabled !== false && !!getFirebaseConfig();
}

/** Message clair quand l'IA ne répond pas (pas activée dans Firebase, pas d'Internet…). */
export function aiErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string })?.code ?? '';
  if (/quota|429|RESOURCE_EXHAUSTED/i.test(m)) return 'La limite gratuite de l’IA est atteinte pour le moment (tous les modèles essayés). Elle se reconnecte toute seule plus tard. J’utilise l’assistant de base.';
  if (/no longer available|NOT_FOUND|\b404\b/i.test(m)) return 'Un modèle de l’IA n’est plus disponible chez Google (liste à mettre à jour dans l’app). J’utilise l’assistant de base.';
  if (/api-not-enabled|firebasevertexai|generativelanguage|AI Logic|PERMISSION_DENIED|403/i.test(code + m)) return 'L’assistant IA n’est pas encore activé dans Firebase (Paramètres → Assistant IA). J’utilise l’assistant de base.';
  if (/timeout|timed out|abort/i.test(m)) return 'L’IA ne répond pas (délai dépassé): la connexion à Google est bloquée ou trop lente. J’utilise l’assistant de base.';
  if (/fetch|network|Failed to fetch|offline/i.test(m)) return 'Pas d’Internet: j’utilise l’assistant de base.';
  if (/quota|429|RESOURCE_EXHAUSTED/i.test(m)) return 'Limite de l’IA atteinte pour le moment: j’utilise l’assistant de base.';
  return `Assistant IA: ${code ? `[${code}] ` : ''}${m}`;
}
export const overQuota = (e: unknown) => /quota|429|RESOURCE_EXHAUSTED/i.test(`${(e as { code?: string })?.code ?? ''} ${e instanceof Error ? e.message : e}`);
export const notFound = (e: unknown) => /not found|404|NOT_FOUND|is not supported|no-model/i.test(`${(e as { code?: string })?.code ?? ''} ${e instanceof Error ? e.message : e}`);

const INTENTS: Record<string, IntentKind> = { payee: 'payee', relancer: 'relancer', depense: 'depense', deplacer: 'deplacer', fini: 'fini', combien: 'combien', horaire: 'horaire', afaire: 'afaire', facturer_job: 'facturer' };

export class AiAssistant {
  private chat: ChatSession | null = null;
  private model = '';
  private pending: Part[] = []; // réponses aux fonctions d'action (envoyées avec le prochain message)
  constructor(private ctx: { company: string; services: AiService[]; clients: () => AiClient[]; today: string; model?: string }) {}

  private open(model: string) {
    const app = firebaseApp();
    if (!app) throw new Error('Firebase n’est pas configuré');
    const ai = getAI(app, { backend: new VertexAIBackend('global') });
    const gm = getGenerativeModel(ai, {
      model,
      systemInstruction: systemPrompt(this.ctx.company, this.ctx.services, this.ctx.today),
      tools: [{ functionDeclarations: TOOLS }],
      generationConfig: { temperature: 0.2 },
    }, { timeout: AI_TIMEOUT_MS });
    this.model = model;
    this.chat = gm.startChat();
  }

  private async sendRaw(parts: (string | Part)[]) {
    if (!this.chat) {
      const list = this.ctx.model ? [this.ctx.model, ...MODELS.filter((m) => m !== this.ctx.model)] : MODELS;
      let last: unknown;
      for (const m of list) {
        try {
          this.open(m);
          return await this.chat!.sendMessage(parts);
        } catch (e) {
          last = e;
          this.chat = null;
          if (!notFound(e) && !overQuota(e)) throw e;
        }
      }
      throw last;
    }
    return this.chat.sendMessage(parts);
  }

  get modelName() {
    return this.model;
  }

  /** Une phrase de l'utilisateur → une réponse à dire, ou une action à confirmer. */
  async send(text: string, image?: { mimeType: string; data: string }): Promise<AiResult> {
    // Gemini refuse de mélanger une réponse de fonction avec du texte: on la renvoie seule d'abord
    if (this.pending.length && this.chat) {
      const answers = this.pending;
      this.pending = [];
      try {
        await this.chat.sendMessage(answers);
      } catch {
        this.chat = null; // conversation abîmée: on repart à neuf
      }
    }
    this.pending = [];
    let res = await this.sendRaw([text, ...(image ? [{ inlineData: image }] : [])]);
    for (let round = 0; round < 5; round++) {
      const calls: FunctionCall[] = res.response.functionCalls() ?? [];
      const say = (() => {
        try {
          return res.response.text().trim();
        } catch {
          return '';
        }
      })();
      if (!calls.length) return { kind: 'say', text: say || 'Désolée, je n’ai pas compris. Peux-tu répéter?' };
      const answers: Part[] = [];
      let action: AiResult | null = null;
      for (const c of calls) {
        const a = (c.args ?? {}) as Record<string, unknown>;
        if (c.name === 'chercher_client') {
          const found = await lookupClients(String(a.nom ?? ''), this.ctx.clients());
          answers.push({ functionResponse: { name: c.name, response: { clients: found } } });
        } else if (c.name === 'preparer_document') {
          const lignes = Array.isArray(a.lignes) ? (a.lignes as Record<string, unknown>[]) : [];
          action = {
            kind: 'doc',
            text: say,
            doc: {
              type: (['facture', 'soumission', 'job', 'visite'].includes(String(a.type)) ? a.type : 'soumission') as AiDoc['type'],
              clientId: typeof a.client_id === 'number' ? a.client_id : undefined,
              name: a.nouveau_client_nom ? String(a.nouveau_client_nom) : undefined,
              phone: a.telephone ? String(a.telephone) : undefined,
              address: a.adresse ? String(a.adresse) : undefined,
              date: /^\d{4}-\d{2}-\d{2}$/.test(String(a.date ?? '')) ? String(a.date) : undefined,
              time: /^\d{1,2}:\d{2}$/.test(String(a.heure ?? '')) ? String(a.heure).padStart(5, '0') : undefined,
              lines: lignes.map((l) => ({ code: l.code ? String(l.code).toUpperCase() : undefined, description: l.description ? String(l.description) : undefined, quantity: Number(l.quantite) > 0 ? Number(l.quantite) : 1, unitPrice: typeof l.prix_unitaire === 'number' ? l.prix_unitaire : undefined })),
            },
          };
          answers.push({ functionResponse: { name: c.name, response: { resultat: 'Résumé affiché; l’utilisateur va le vérifier et confirmer.' } } });
        } else if (c.name === 'ecrire_message') {
          const message = toMessage(a);
          if (message) {
            action = { kind: 'message', text: say, message };
            answers.push({ functionResponse: { name: c.name, response: { resultat: 'Message affiché; l’utilisateur va le relire et l’envoyer.' } } });
          } else {
            answers.push({ functionResponse: { name: c.name, response: { erreur: 'Il faut client_id (de chercher_client) et le texte du message.' } } });
          }
        } else if (c.name === 'modifier_client') {
          const edit = toClientEdit(a);
          if (edit) {
            action = { kind: 'client', text: say, edit };
            answers.push({ functionResponse: { name: c.name, response: { resultat: 'Changement affiché; l’utilisateur va le vérifier et confirmer.' } } });
          } else {
            answers.push({ functionResponse: { name: c.name, response: { erreur: 'Il faut client_id (de chercher_client) et au moins un champ à changer.' } } });
          }
        } else if (c.name === 'commander_fournisseur') {
          const arts = Array.isArray(a.articles) ? (a.articles as Record<string, unknown>[]) : [];
          action = {
            kind: 'order',
            text: say,
            order: {
              supplier: a.fournisseur ? String(a.fournisseur) : undefined,
              items: arts.map((x) => ({ description: String(x.description ?? '').trim(), qty: Number(x.quantite) > 0 ? Number(x.quantite) : 1, unit: String(x.unite ?? 'unité') })).filter((x) => x.description),
              clientId: typeof a.client_id === 'number' ? a.client_id : undefined,
              neededBy: /^\d{4}-\d{2}-\d{2}$/.test(String(a.date ?? '')) ? String(a.date) : undefined,
            },
          };
          answers.push({ functionResponse: { name: c.name, response: { resultat: 'Commande préparée; il va l’envoyer au fournisseur.' } } });
        } else if (c.name === 'commande_rapide') {
          const kind = INTENTS[String(a.action)] ?? 'afaire';
          action = {
            kind: 'intent',
            text: say,
            intent: {
              kind,
              clientId: typeof a.client_id === 'number' ? a.client_id : undefined,
              date: a.date ? String(a.date) : undefined,
              time: a.heure ? String(a.heure) : undefined,
              amount: typeof a.montant === 'number' ? a.montant : undefined,
              method: a.mode_paiement ? String(a.mode_paiement) : undefined,
              category: a.categorie ? String(a.categorie) : kind === 'depense' ? 'Autre' : undefined,
              vendor: a.fournisseur ? String(a.fournisseur) : undefined,
              period: a.periode ? (String(a.periode) as Intent['period']) : kind === 'combien' ? 'mois' : undefined,
            },
          };
          answers.push({ functionResponse: { name: c.name, response: { resultat: 'Affiché à l’utilisateur.' } } });
        } else {
          answers.push({ functionResponse: { name: c.name, response: { erreur: 'Fonction inconnue' } } });
        }
      }
      if (action) {
        this.pending = answers;
        return action;
      }
      res = await this.chat!.sendMessage(answers);
    }
    return { kind: 'say', text: 'Je me suis mêlée. Peux-tu reformuler?' };
  }
}

/** Rédige un court message au client (texto ou courriel) à partir d'une intention. */
export async function aiWrite(opts: { company: string; owner: string; client: string; channel: 'texto' | 'courriel'; intent: string; history: string[]; model?: string }): Promise<string> {
  const app = firebaseApp();
  if (!app) throw new Error('Firebase n’est pas configuré');
  const ai = getAI(app, { backend: new VertexAIBackend('global') });
  const prompt = `Tu rédiges un ${opts.channel === 'texto' ? 'texto (2 ou 3 phrases maximum)' : 'courriel court (sans objet)'} de ${opts.owner || 'le patron'} de ${opts.company || 'l’entreprise'} à son client ${opts.client}.
Ton: professionnel, chaleureux, français du Québec, vouvoiement. Pas de markdown, pas de placeholder entre crochets, signe avec le prénom${opts.channel === 'courriel' ? ' et le nom de l’entreprise' : ''}.
Derniers échanges (du plus ancien au plus récent):
${opts.history.slice(-6).join('\n') || '(aucun)'}
Ce qu’il veut dire: ${opts.intent}
Écris seulement le message.`;
  let last: unknown;
  for (const m of opts.model ? [opts.model, ...MODELS] : MODELS) {
    try {
      const r = await getGenerativeModel(ai, { model: m, generationConfig: { temperature: 0.5 } }, { timeout: AI_TIMEOUT_MS }).generateContent(prompt);
      return r.response.text().trim();
    } catch (e) {
      last = e;
      if (!notFound(e) && !overQuota(e)) throw e;
    }
  }
  throw last;
}

/**
 * Devis à partir d'un courriel du client ou de quelques mots: l'IA écrit le devis (dans le style du modèle),
 * repère le client (nom, courriel, téléphone, adresse) et note ce qui manque pour bien chiffrer.
 */
export async function aiDevis(opts: { company: string; owner: string; trades: string; text: string; style: Devis; current?: Devis; clientKnown?: string; prices?: PriceRef[]; model?: string }): Promise<DevisDraft> {
  const app = firebaseApp();
  if (!app) throw new Error('Firebase n’est pas configuré');
  const ai = getAI(app, { backend: new VertexAIBackend('global') });
  const asJson = (d: Devis) => ({
    titre: d.heading,
    sections: d.sections.map((x) => ({ titre: x.title, points: x.items, compter: x.countLabel ?? '' })),
    note_prix: d.priceNote,
    conditions: d.conditions,
    mot_de_la_fin: d.closing,
  });
  const prompt = `Tu prépares un devis (soumission détaillée) pour ${opts.company || 'une entreprise de services'} (${opts.trades || 'entrepreneur'}), au Québec, signé par ${opts.owner || 'le patron'}.
Le texte reçu est soit un courriel ou un message d’un client (demande de soumission), soit une consigne de l’entrepreneur.
${opts.current ? `Devis actuel: ${JSON.stringify(asJson(opts.current))}
Si le texte demande un changement (ajouter, enlever, changer le prix…), applique-le au devis actuel et garde le reste. Sinon, écris un nouveau devis.
` : ''}Écris le devis selon ce qui est demandé dans le texte, peu importe le type de travaux. N’invente pas d’éléments qui ne sont pas demandés.
Style à imiter (structure et ton seulement, pas le contenu): ${JSON.stringify(asJson(opts.style))}
Règles:
- Français du Québec, ton professionnel, vouvoiement.
- « titre »: « Soumission de … » selon les travaux.
- Première section: ce qui est visé (« Ouvertures visées », « Pièces visées », « Travaux visés »…), un élément par point, chiffré quand le nombre est connu (ex.: « 5 fenêtres au sous-sol »). « compter »: le mot pour le total (ex.: « ouvertures ») seulement si les éléments se comptent, sinon vide.
- Deuxième section « Travaux inclus »: les étapes, phrases terminées par « ; » et la dernière par « . ».
- « conditions »: 2 à 4 conditions utiles pour ces travaux. « note_prix »: une phrase utile sous le prix, ou vide.
- « prix »: seulement si un prix est donné (nombre, sans $). « taxes_incluses »: true si « taxes incluses », false si « plus taxes », sinon absent.
- « client »: les coordonnées du client trouvées dans le texte (nom, contact, courriel, telephone, adresse); jamais celles de ${opts.company || 'l’entreprise'}.${opts.clientKnown ? ` Le client est déjà choisi: ${opts.clientKnown}.` : ''}
- « adresse »: l’adresse des travaux si elle est donnée. « courriel_client »: true si le texte est un message écrit par le client.
- « questions »: ce qu’il faudrait demander au client pour bien chiffrer (0 à 3 courtes questions).
- « estimation »: le calcul du prix AVANT taxes avec MES prix ci-dessous: une ligne par élément (code de ma liste quand il s’applique, description, quantite, unite, prix_unitaire). Quantités selon le texte (ex.: 6 fenêtres + 9 fenêtres + 1 porte = 16 au code des fenêtres). Si rien dans ma liste ne s’applique, mets code vide et un prix réaliste au Québec, et écris « (estimé) » dans la description. Si une quantité n’est pas dite, suppose une valeur raisonnable.
- « explication_prix »: une phrase courte sur les hypothèses du calcul (quantités supposées, ce qui n’est pas compté).
Mes prix (code | description | unité | prix | minimum de la ligne):
${(opts.prices ?? []).slice(0, 90).map((p) => `${p.code} | ${p.name} | ${p.unit} | ${p.price} | ${p.minimum || 0}`).join('\n') || '(aucune liste: estime avec des prix réalistes au Québec)'}
Format JSON: {"titre":"","sections":[{"titre":"","points":[""],"compter":""}],"note_prix":"","conditions":[""],"mot_de_la_fin":"","prix":0,"taxes_incluses":true,"adresse":"","client":{"nom":"","contact":"","courriel":"","telephone":"","adresse":""},"courriel_client":false,"questions":[""],"estimation":[{"code":"","description":"","quantite":1,"unite":"","prix_unitaire":0}],"explication_prix":""}
Texte:
"""
${opts.text.slice(0, 12000)}
"""
Réponds uniquement avec le JSON.`;
  let last: unknown;
  for (const m of opts.model ? [opts.model, ...MODELS] : MODELS) {
    try {
      const r = await getGenerativeModel(ai, { model: m, generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } }, { timeout: AI_TIMEOUT_MS * 2 }).generateContent(prompt);
      const txt = r.response.text().trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      return devisFromJson(JSON.parse(txt), opts.current ?? opts.style, opts.prices);
    } catch (e) {
      last = e;
      if (e instanceof SyntaxError) continue;
      if (!notFound(e) && !overQuota(e)) throw e;
    }
  }
  throw last;
}