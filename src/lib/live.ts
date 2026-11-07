// Mode conversation: on jase naturellement avec l'assistant, à voix haute, comme avec ChatGPT.
// Gemini Live gère l'écoute, la voix de réponse et les interruptions; les actions (facture, job, commande…)
// passent par les mêmes fonctions que l'assistant écrit et sont toujours confirmées à l'écran.
import { getAI, getLiveGenerativeModel, ResponseModality, startAudioConversation, VertexAIBackend, type AudioConversationController, type FunctionCall, type FunctionResponse } from 'firebase/ai';
import type { Intent, IntentKind } from './assistant';
import { lookupClients, normalizeAction, systemPrompt, toClientEdit, toMessage, TOOLS, type AiClient, type AiDoc, type AiResult, type AiService } from './ai';
import { firebaseApp } from './sync';

const LIVE_MODELS = ['gemini-live-2.5-flash'];
const INTENTS: Record<string, IntentKind> = { payee: 'payee', relancer: 'relancer', depense: 'depense', deplacer: 'deplacer', fini: 'fini', combien: 'combien', horaire: 'horaire', afaire: 'afaire', facturer_job: 'facturer' };

export interface LiveConfig {
  company: string;
  today: string;
  services: AiService[];
  clients: () => AiClient[];
  /** Une action à afficher et à confirmer (facture, soumission, job, commande…). */
  onResult: (r: AiResult) => void;
  /** La conversation s'est terminée (coupure, délai de Google…). */
  onClose: () => void;
}

export interface LiveHandle {
  stop: () => Promise<void>;
}

export function liveSupported(): boolean {
  return typeof AudioWorkletNode !== 'undefined' && typeof AudioContext !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** Appel de fonction de l'IA → action à confirmer (même logique que l'assistant écrit). */
function toResult(name: string, a: Record<string, unknown>): AiResult | null {
  if (name === 'preparer_document') {
    const lignes = Array.isArray(a.lignes) ? (a.lignes as Record<string, unknown>[]) : [];
    const doc: AiDoc = {
      type: (['facture', 'soumission', 'job', 'visite'].includes(String(a.type)) ? a.type : 'soumission') as AiDoc['type'],
      clientId: typeof a.client_id === 'number' ? a.client_id : undefined,
      name: a.nouveau_client_nom ? String(a.nouveau_client_nom) : undefined,
      phone: a.telephone ? String(a.telephone) : undefined,
      address: a.adresse ? String(a.adresse) : undefined,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(a.date ?? '')) ? String(a.date) : undefined,
      time: /^\d{1,2}:\d{2}$/.test(String(a.heure ?? '')) ? String(a.heure).padStart(5, '0') : undefined,
      detailed: a.devis_detaille === true,
      lines: lignes.map((l) => ({ code: l.code ? String(l.code).toUpperCase() : undefined, description: l.description ? String(l.description) : undefined, quantity: Number(l.quantite) > 0 ? Number(l.quantite) : 1, unit: l.unite ? String(l.unite) : undefined, unitPrice: typeof l.prix_unitaire === 'number' ? l.prix_unitaire : undefined })),
    };
    return { kind: 'doc', text: '', doc };
  }
  if (name === 'ecrire_message') {
    const message = toMessage(a);
    return message ? { kind: 'message', text: '', message } : null;
  }
  if (name === 'modifier_client') {
    const edit = toClientEdit(a);
    return edit ? { kind: 'client', text: '', edit } : null;
  }
  if (name === 'commander_fournisseur') {
    const arts = Array.isArray(a.articles) ? (a.articles as Record<string, unknown>[]) : [];
    return {
      kind: 'order',
      text: '',
      order: {
        supplier: a.fournisseur ? String(a.fournisseur) : undefined,
        items: arts.map((x) => ({ description: String(x.description ?? '').trim(), qty: Number(x.quantite) > 0 ? Number(x.quantite) : 1, unit: String(x.unite ?? 'unité') })).filter((x) => x.description),
        clientId: typeof a.client_id === 'number' ? a.client_id : undefined,
        neededBy: /^\d{4}-\d{2}-\d{2}$/.test(String(a.date ?? '')) ? String(a.date) : undefined,
      },
    };
  }
  if (name === 'commande_rapide') {
    const kind = INTENTS[String(a.action)] ?? 'afaire';
    const intent: Intent = {
      kind,
      clientId: typeof a.client_id === 'number' ? a.client_id : undefined,
      date: a.date ? String(a.date) : undefined,
      time: a.heure ? String(a.heure) : undefined,
      amount: typeof a.montant === 'number' ? a.montant : undefined,
      method: a.mode_paiement ? String(a.mode_paiement) : undefined,
      category: a.categorie ? String(a.categorie) : kind === 'depense' ? 'Autre' : undefined,
      vendor: a.fournisseur ? String(a.fournisseur) : undefined,
      period: a.periode ? (String(a.periode) as Intent['period']) : kind === 'combien' ? 'mois' : undefined,
    };
    return { kind: 'intent', text: '', intent };
  }
  return null;
}

const VOICE_RULES =
  '\n\nMODE CONVERSATION VOCALE (tu parles à voix haute, en direct): sois naturelle et chaleureuse, comme une vraie secrétaire québécoise au téléphone. ' +
  'Réponds tout de suite, en une ou deux phrases courtes, sans listes, et ne répète JAMAIS ce que l’utilisateur vient de dire: agis ou pose la question qui manque. Ignore tout bruit qui ressemble à ta propre voix. Si on t’interrompt, arrête-toi et écoute. ' +
  'Quand tu prépares une facture, une soumission, une job ou une commande, dis simplement ce que tu as préparé et que le résumé est à l’écran pour confirmer.';

export async function startLive(cfg: LiveConfig): Promise<LiveHandle> {
  const app = firebaseApp();
  if (!app) throw new Error('Firebase n’est pas configuré');
  const ai = getAI(app, { backend: new VertexAIBackend('global') });
  const instruction = systemPrompt(cfg.company, cfg.services, cfg.today) + VOICE_RULES;
  let last: unknown;
  for (const model of LIVE_MODELS) {
    try {
      const lm = getLiveGenerativeModel(ai, {
        model,
        generationConfig: { responseModalities: [ResponseModality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } },
        tools: [{ functionDeclarations: TOOLS }],
        systemInstruction: instruction,
      });
      const session = await lm.connect();
      const controller: AudioConversationController = await startAudioConversation(session, {
        functionCallingHandler: async (calls: FunctionCall[]): Promise<FunctionResponse> => {
          const c = calls[0];
          const a = (c.args ?? {}) as Record<string, unknown>;
          if (c.name === 'chercher_client') {
            const found = await lookupClients(String(a.nom ?? ''), cfg.clients());
            return { name: c.name, response: { clients: found } };
          }
          const res = toResult(c.name, a);
          if (res) cfg.onResult(normalizeAction(res, cfg.clients()));
          return { name: c.name, response: { resultat: res ? 'Résumé affiché à l’écran; l’utilisateur va le vérifier et confirmer.' : 'Fonction inconnue' } };
        },
      });
      let closed = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      const stop = async () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          await controller.stop();
        } catch {
          /* déjà arrêtée */
        }
        try {
          await session.close();
        } catch {
          /* déjà fermée */
        }
      };
      timer = setInterval(() => {
        if (session.isClosed && !closed) void stop().then(cfg.onClose);
      }, 2000);
      return { stop };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
