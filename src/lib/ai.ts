// Assistant IA: Gemini Flash via Firebase AI Logic (pas de clé à gérer, pas de serveur à nous).
// L'IA comprend la phrase, cherche le client, pose les questions qui manquent, puis PROPOSE:
// rien n'est créé sans que l'utilisateur confirme dans l'app.
import { getAI, getGenerativeModel, VertexAIBackend, Schema, type ChatSession, type FunctionCall, type FunctionDeclaration, type Part } from 'firebase/ai';
import type { Intent, IntentKind } from './assistant';
import { devisFromJson, type Devis } from './devis';
import { findClients } from './fuzzy';
import { firebaseApp, getFirebaseConfig } from './sync';

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
export type AiResult =
  | { kind: 'say'; text: string }
  | { kind: 'order'; order: AiOrder; text: string }
  | { kind: 'doc'; doc: AiDoc; text: string }
  | { kind: 'intent'; intent: Intent; text: string };

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
  return `Tu es la secrétaire de ${company || 'l’entreprise'}, une entreprise de services au Québec. Le patron te parle en conduisant ou sur un chantier, souvent à voix (la dictée fait des fautes: devine le sens).
Aujourd’hui: ${day} (${today}).

Ta job: comprendre ce qu’il veut et le préparer avec les fonctions. Il confirme toujours dans l’app avant que ce soit créé.
- Un nom de client est dit: appelle chercher_client. Un seul résultat qui ressemble: c’est lui. Plusieurs: demande lequel (nomme-les). Aucun: c’est un nouveau client.
- Facture: il faut le client et les travaux. Soumission: client, adresse, travaux. Job: client, adresse, travaux, date. Visite: client, adresse, date.
- Pose UNE seule question courte à la fois pour ce qui manque. Pas besoin de l’heure ni du téléphone s’il ne les dit pas.
- Travaux: utilise les codes de la liste de prix. Quantités en nombres (pieds, fenêtres, heures…). N’invente jamais de prix.
- Dates: convertis « demain », « mardi », « le 14 » en YYYY-MM-DD (dans le futur).
- Des matériaux à acheter (« commande », « faut que j’achète », « appelle le fournisseur »): appelle commander_fournisseur.
- Dès que tu as l’essentiel, appelle preparer_document (ou commande_rapide pour le reste) sans redemander de confirmation.
- Tu es AUSSI une assistante personnelle complète, pas seulement pour les factures: réponds directement à toute question (calcul de quantités de matériaux comme la peinture, le béton, les bardeaux, conversions, prix approximatifs, conseils de métier, idées, rédaction de messages). Donne le résultat tout de suite avec tes hypothèses courantes (ex.: un gallon de peinture couvre environ 350 pi², compte 2 couches; arrondis à l’achat), sans demander la permission. Ne refuse jamais une demande ordinaire.
- Si on te demande une action de l’app que tu n’as pas (ex.: modifier une fiche), dis-le simplement et propose l’étape la plus proche.
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
  async send(text: string): Promise<AiResult> {
    let res = await this.sendRaw([...this.pending, text]);
    this.pending = [];
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
          const found = findClients(String(a.nom ?? ''), this.ctx.clients()).map((x) => ({ id: x.id, nom: x.name, adresse: x.address || '', telephone: x.phone || '' }));
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

/** Rédige un devis détaillé (sections à puces, conditions) à partir de quelques mots, dans le style du modèle. */
export async function aiDevis(opts: { company: string; trades: string; description: string; base: Devis; model?: string }): Promise<ReturnType<typeof devisFromJson>> {
  const app = firebaseApp();
  if (!app) throw new Error('Firebase n’est pas configuré');
  const ai = getAI(app, { backend: new VertexAIBackend('global') });
  const example = {
    titre: opts.base.heading,
    sections: opts.base.sections.map((s) => ({ titre: s.title, points: s.items, compter: s.countLabel ?? '' })),
    note_prix: opts.base.priceNote,
    conditions: opts.base.conditions,
    mot_de_la_fin: opts.base.closing,
  };
  const prompt = `Tu rédiges un devis (soumission détaillée) pour ${opts.company || 'une entreprise de services'} (${opts.trades || 'entrepreneur'}), au Québec.
Français du Québec, ton professionnel, vouvoiement. Garde exactement la structure et le style de l’exemple; adapte le contenu à la description.
Règles: une section « visée » avec les éléments chiffrés (ex.: « 5 fenêtres au sous-sol »), puis « Travaux inclus » (phrases terminées par « ; », la dernière par « . »).
« compter » = le mot pour le total de la section (ex.: « ouvertures »), sinon vide. N’invente pas de prix: « prix » seulement s’il est dit (nombre, sans $).
« taxes_incluses »: true si on dit taxes incluses, false si on dit plus taxes, sinon absent. « adresse »: l’adresse des travaux si elle est dite.
Exemple (format JSON à respecter):
${JSON.stringify(example)}
Description de la job: ${opts.description}
Réponds uniquement avec le JSON.`;
  let last: unknown;
  for (const m of opts.model ? [opts.model, ...MODELS] : MODELS) {
    try {
      const r = await getGenerativeModel(ai, { model: m, generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } }, { timeout: AI_TIMEOUT_MS }).generateContent(prompt);
      const txt = r.response.text().trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      return devisFromJson(JSON.parse(txt), opts.base);
    } catch (e) {
      last = e;
      if (e instanceof SyntaxError) continue;
      if (!notFound(e) && !overQuota(e)) throw e;
    }
  }
  throw last;
}
