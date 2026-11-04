import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck, CalendarDays, Check, ClipboardList, FileText, MapPin, Mic, RotateCcw, Sparkles, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AddressInput } from '../components/AddressInput';
import { ClientPicker } from '../components/ClientPicker';
import { lineFromService, LineItems } from '../components/LineItems';
import { errMsg, useToast } from '../components/Toast';
import { blankJob, jobToInvoice, smsLink } from '../lib/agenda';
import { db, getSettings, takeNextNumber, type Doc, type GeoPoint, type LineItem } from '../lib/db';
import { suggestAddresses } from '../lib/geo';
import { useSettings } from '../lib/hooks';
import { listen, speechSupported, type Listening } from '../lib/speech';
import { hearingSupported, listenCloud, setHearingHints } from '../lib/hearing';
import { isNative } from '../lib/native';
import { addDays, docTotals, lineAmount, money, todayISO } from '../lib/utils';
import { parseDictation } from '../lib/voice';
import { findWhen, parseJobCommand } from '../lib/voiceJob';
import { wordsToNumbers } from '../lib/voice';
import { detectIntent } from '../lib/assistant';
import { propose, quoteToInvoice, type Outcome, type Proposal, type Step } from '../lib/assistantActions';
import { ConfirmList } from '../components/ConfirmList';
import { RelanceModal } from '../components/RelanceModal';
import { MicButton } from '../components/MicButton';
import { Link } from 'react-router-dom';
import { AiAssistant, aiConfigured, aiErrorMessage, type AiDoc, type AiResult } from '../lib/ai';
import { liveSupported, startLive } from '../lib/live';
import { createOrder } from '../lib/orders';

const EXAMPLE = '« Véronique Girard, 12 rue des Pins à Laval, entretien de gouttières 60 pieds linéaires mardi à 9 h »';
const IDEAS = ['Facture la job de Girard', 'Roy a payé comptant', '45 $ d’essence chez Petro-Canada', 'Déplace Roy à vendredi 9 h', 'J’ai fini la job chez Gagnon', 'Mon horaire demain', 'Combien j’ai fait ce mois-ci?', 'Qu’est-ce que j’ai à faire?', 'Relance les factures en retard'];

interface Draft {
  clientId?: number;
  name: string;
  phone: string;
  address: string;
  geo?: GeoPoint;
  date: string;
  time: string;
  durationMin: number;
  items: LineItem[];
  quote: boolean;
  kind: 'visite' | 'job';
  docType: 'quote' | 'invoice';
  dateSaid: boolean;
  noJob: boolean; // soumission sans journée planifiée
  addrIncomplete: boolean;
}

type Slot = 'name' | 'address' | 'job' | 'date';

const QUESTIONS: Record<Slot, (d: Draft) => string> = {
  name: () => 'C’est pour quel client?',
  address: (d) => (d.address ? `L’adresse, c’est ${d.address}… quoi au juste?` : 'À quelle adresse?'),
  job: (d) => (d.kind === 'visite' ? 'OK! C’est quoi la job pour la soumission?' : d.docType === 'invoice' ? 'C’est quoi la job à facturer?' : 'C’est quoi la job?'),
  date: () => 'C’est pour quand?',
};
const EXAMPLES: Record<Slot, string> = {
  name: 'ex.: « Nathalie Bouchard »',
  address: 'ex.: « 1835 rue des Érables à Laval »',
  job: 'ex.: « 50 pieds de gouttières à laver »',
  date: 'ex.: « jeudi à 10 h » — ou « pas de date »',
};

const hasWork = (d: Draft) => d.items.some((it) => it.code || it.unitPrice || it.description.trim());
/** Prochaine info manquante (une question à la fois). */
function nextSlot(d: Draft): Slot | null {
  if (!d.clientId && !d.name.trim()) return 'name';
  if (!d.address.trim() || d.addrIncomplete) return 'address';
  if (!hasWork(d)) return 'job';
  if (d.docType !== 'invoice' && !d.dateSaid) return 'date';
  return null;
}

/** L'app parle (si le téléphone le permet), puis appelle « then » quand elle a fini. */
function say(text: string, then?: () => void) {
  let called = false;
  const once = () => {
    if (!called && then) {
      called = true;
      then();
    }
  };
  try {
    const u = new SpeechSynthesisUtterance(text.replace(/’/g, "'"));
    u.lang = 'fr-CA';
    u.rate = 1.05;
    u.onend = once;
    u.onerror = once;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    // Certains Android n'annoncent jamais la fin: on rouvre le micro quand même
    if (then) setTimeout(once, 900 + text.length * 70);
  } catch {
    once();
  }
}
const capName = (t: string) => t.trim().replace(/[.!?]+$/, '').replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/** Une phrase → client, job planifiée et soumission prête (puis la facture d'un bouton). */
export default function VoiceJob() {
  const nav = useNavigate();
  const notify = useToast();
  const s = useSettings();
  const services = useLiveQuery(() => db.services.orderBy('order').toArray(), []) ?? [];
  const clients = useLiveQuery(() => db.clients.toArray(), []) ?? [];
  const [listening, setListening] = useState(false);
  const [live, setLive] = useState(false); // conversation à voix haute avec l'IA (comme ChatGPT)
  const liveRef = useRef<{ stop: () => Promise<void> } | null>(null);
  const liveTurn = useRef<(r: AiResult) => void>(() => undefined);
  useEffect(() => () => void liveRef.current?.stop(), []);
  const [heard, setHeard] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [found, setFound] = useState<{ label: string; geo: GeoPoint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ jobId?: number; quoteId?: number; invoiceId?: number; date: string; time: string; total: number; number?: string; visit: boolean } | null>(null);
  const rec = useRef<Listening | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const voiceMode = useRef(false);
  const listeningRef = useRef(false); // on parle: après chaque question, le micro se rouvre tout seul
  const [answer, setAnswer] = useState('');
  const target = useRef<'cmd' | 'answer'>('cmd');
  const up = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  useEffect(() => () => rec.current?.stop(), []);
  const [prop, setProp] = useState<Proposal | null>(null);
  const [relanceDoc, setRelanceDoc] = useState<Proposal['relance'] | null>(null);
  // Message écrit par l'IA pour un client: modifiable avant l'envoi
  const [msg, setMsg] = useState<{ name: string; phone: string; email: string; text: string; subject: string } | null>(null);
  // Après « Analyser »: on amène la réponse à l'écran (sur cell elle était cachée en haut)
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (prop || draft || done) topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [prop, done, !!draft, slot]);

  const show = (p: Outcome) => {
    setProp(p);
    if (p.say) say(p.say);
  };
  const doStep = async (step: Step) => {
    setBusy(true);
    try {
      show(await step.run());
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  // ── Assistant IA (Gemini via Firebase): comprend la phrase, pose les questions, propose ──
  const aiRef = useRef<AiAssistant | null>(null);
  // IA en pause après une erreur (limite, réseau…): l'assistant de base prend le relais, puis l'IA se reconnecte toute seule
  const [aiPause, setAiPause] = useState<{ until: number; why: string } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!aiPause) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, aiPause.until - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [aiPause]);
  const clientsRef = useRef(clients);
  clientsRef.current = clients;
  const [convo, setConvo] = useState<{ me: boolean; text: string }[]>([]);
  const [thinking, setThinking] = useState(false);
  const aiReady = !!s && aiConfigured(s.aiAssistant);
  const aiOn = aiReady && (!aiPause || Date.now() >= aiPause.until);
  const reconnectAi = () => {
    setAiPause(null);
    aiRef.current = null;
    setConvo([]);
  };
  const resetAi = () => {
    aiRef.current = null;
    setConvo([]);
  };

  const fromAi = (a: AiDoc): Draft => {
    const c = a.clientId ? clients.find((x) => x.id === a.clientId) : undefined;
    const items: LineItem[] = a.lines.map((l) => {
      const sv = l.code ? services.find((x) => x.code.toUpperCase() === l.code) : undefined;
      if (sv) {
        const it = lineFromService(sv, l.quantity, c?.lang ?? 'fr');
        return l.unitPrice != null ? { ...it, unitPrice: l.unitPrice } : it;
      }
      return { code: '', description: l.description || l.code || 'Travaux', quantity: l.quantity, unitPrice: l.unitPrice ?? 0 };
    });
    const invoice = a.type === 'facture';
    return {
      clientId: c?.id,
      name: c?.name ?? a.name ?? '',
      phone: a.phone ?? c?.phone ?? '',
      address: a.address ?? c?.address ?? '',
      geo: a.address ? undefined : c?.geo,
      date: a.date ?? todayISO(),
      time: a.time ?? '',
      durationMin: 120,
      items,
      quote: a.type !== 'visite' && !invoice,
      kind: a.type === 'visite' ? 'visite' : 'job',
      docType: invoice ? 'invoice' : 'quote',
      dateSaid: !!a.date || invoice || a.type === 'soumission',
      noJob: invoice || (a.type === 'soumission' && !a.date),
      addrIncomplete: false,
    };
  };

  const aiTurn = async (text: string, preset?: AiResult) => {
    setProp(null);
    setMsg(null);
    setDone(null);
    setHeard('');
    setConvo((c) => [...c, { me: true, text }]);
    setThinking(true);
    try {
      if (!aiRef.current) {
        aiRef.current = new AiAssistant({
          company: s?.companyName ?? '',
          services: services.map((x) => ({ code: x.code, name: x.name, unit: x.unit, price: x.price })),
          clients: () => clientsRef.current.map((c) => ({ id: c.id, name: c.name, address: c.address, phone: c.phone })),
          today: todayISO(),
          model: s?.aiModel || undefined,
          assistantName: s?.aiName || undefined,
        });
      }
      const r = preset ?? (await aiRef.current.send(text));
      if (r.text) setConvo((c) => [...c, { me: false, text: r.text }]);
      if (r.kind === 'say') {
        say(r.text, () => { if (voiceMode.current && speechSupported()) latest.current.mic('cmd', true); });
      } else if (r.kind === 'doc') {
        setFound(null);
        const d = fromAi(r.doc);
        proceed(d);
        if (r.doc.address) autoAddress(r.doc.address);
      } else if (r.kind === 'message') {
        setDraft(null);
        const cur = clients.find((x) => x.id === r.message.clientId);
        if (!cur) {
          notify('Client introuvable: dis-moi son nom.', 'err');
          return;
        }
        setMsg({ name: cur.name, phone: cur.phone, email: cur.email, text: r.message.text, subject: r.message.subject ?? `Message de ${s?.companyName || 'votre entrepreneur'}` });
        say(r.text || `Voici le message pour ${cur.name}. Relis-le, change ce que tu veux et envoie-le.`);
      } else if (r.kind === 'client') {
        setDraft(null);
        const { clientId, ...fields } = r.edit;
        const cur = clients.find((x) => x.id === clientId);
        if (!cur) {
          notify('Client introuvable: dis-moi son nom.', 'err');
          return;
        }
        const labels: Record<string, string> = { name: 'Nom', contact: 'Contact', phone: 'Téléphone', email: 'Courriel', address: 'Adresse', notes: 'Notes' };
        const changes = Object.entries(fields).filter(([, v]) => v !== undefined) as [keyof typeof labels, string][];
        const summary = changes.map(([k, v]) => `${labels[k]}: ${v}`).join(' · ');
        const proposal: Proposal = {
          title: `Modifier ${cur.name}?`,
          say: r.text || `Je change la fiche de ${cur.name}: ${summary}. Confirme.`,
          confirm: {
            label: 'Confirmer le changement',
            run: async () => {
              const patch: Record<string, unknown> = Object.fromEntries(changes);
              if (fields.address) patch.geo = undefined; // nouvelle adresse: la position se recalcule
              await db.clients.update(clientId, patch);
              return { title: 'Client modifié', say: `Fiche de ${fields.name ?? cur.name} mise à jour.`, links: [{ label: 'Ouvrir la fiche', to: `/clients/${clientId}` }], done: true };
            },
          },
        };
        setProp(proposal);
        say(proposal.say);
      } else if (r.kind === 'order') {
        setDraft(null);
        const supplier = r.order.supplier;
        const id = await createOrder(r.order.items.length ? r.order.items : [{ description: '', qty: 1, unit: 'unité' }], { ...(supplier ? { supplier } : {}), clientId: r.order.clientId, neededBy: r.order.neededBy });
        show({ title: 'Commande prête', say: r.text || `Commande prête${supplier ? ` pour ${supplier}` : ''}. Vérifie et envoie-la.`, links: [{ label: 'Ouvrir et envoyer', to: `/achats/${id}` }] });
      } else {
        setDraft(null);
        void propose(r.intent).then(show).catch((e) => notify(errMsg(e), 'err'));
      }
    } catch (e) {
      // IA pas activée / pas d'Internet: l'assistant de base prend le relais (sans perdre la phrase)
      const msg = aiErrorMessage(e);
      // Pause courte: une connexion lente ou la limite du moment ne coupent plus l'IA jusqu'à la fermeture de l'app
      const ms = /limite/i.test(msg) ? 10 * 60_000 : /pas encore activé/i.test(msg) ? 2 * 60_000 : /Internet|délai/i.test(msg) ? 30_000 : 60_000;
      setAiPause({ until: Date.now() + ms, why: msg.replace(/^Assistant IA: /, '').replace(/ ?J’utilise l’assistant de base\.?/, '') });
      aiRef.current = null;
      setConvo([]);
      notify(msg, 'err');
      basicAnalyse(text);
    } finally {
      setThinking(false);
    }
  };

  // Document créé: la prochaine demande repart d'une conversation neuve
  useEffect(() => {
    if (done) resetAi();
  }, [done]);

  const analyse = (text: string) => {
    if (!text.trim()) return;
    if (aiOn) return void aiTurn(text.trim());
    basicAnalyse(text);
  };

  const basicAnalyse = (text: string) => {
    if (!text.trim()) return;
    setProp(null);
    // « Bonjour », « allo », « merci »: rien à faire — on ne crée pas un client nommé « Bonjour »
    if (/^\s*(bonjour|bonsoir|salut|allo|all[ôo]|hey|yo|hello|coucou|merci|ok|test)\b[\s!.,?]*(toi|l[aà]|ma belle|mon chum)?[\s!.,?]*$/i.test(text)) {
      setDraft(null);
      setDone(null);
      show({ title: '', say: 'Salut! Dis-moi ce que tu veux faire: planifier une job, faire une facture, noter un paiement, une dépense…' });
      return;
    }
    const intent = detectIntent(text, clients, todayISO());
    // « Facture pour Nathalie Bouchard… » (nouveau client): on crée tout
    // Le nom dit ne correspond à aucun client (« Nathalie Bouchard » ≠ « Clinique Bouchard »): nouveau client
    const pj = parseJobCommand(text, services, clients.map((c) => ({ id: c.id, name: c.name })), todayISO());
    const spokenNew = pj.isNew && pj.clientName.split(' ').length >= 2;
    // Une adresse ou des travaux dits = une job à créer, même si un mot ressemble à une autre commande
    const looksLikeJob = (!!pj.address || pj.lines.length > 0) && ['afaire', 'horaire', 'combien', 'fini', 'deplacer'].includes(intent.kind);
    // « Facture pour Denise, 60 pieds de gouttières »: les travaux sont dits → nouvelle facture directement
    const create = intent.kind === 'planifier' || looksLikeJob || (intent.kind === 'facturer' && ((!intent.clientId && /\b(pour|chez|a|à)\s+\p{L}/iu.test(text)) || spokenNew || (!!intent.clientId && pj.lines.length > 0)));
    if (!create) {
      setDraft(null);
      setDone(null);
      void propose(intent).then((p) => {
        // « Facture pour Denise » sans job à facturer: on part une nouvelle facture et on demande la job
        const c = intent.kind === 'facturer' && intent.clientId ? clients.find((x) => x.id === intent.clientId) : undefined;
        if (c && !p.confirm) {
          return proceed({ clientId: c.id, name: c.name, phone: c.phone ?? '', address: c.address ?? '', geo: c.geo, date: todayISO(), time: '', durationMin: 120, items: [], quote: false, kind: 'job', docType: 'invoice', dateSaid: true, noJob: true, addrIncomplete: false });
        }
        show(p);
      }).catch((e) => notify(errMsg(e), 'err'));
      return;
    }
    setProp(null);
    const r = parseJobCommand(text, services, clients.map((c) => ({ id: c.id, name: c.name })), todayISO());
    const c = r.clientId ? clients.find((x) => x.id === r.clientId) : undefined;
    const items = r.lines.map((l) => {
      const sv = services.find((x) => x.code === l.code);
      return sv ? lineFromService(sv, l.quantity, c?.lang ?? 'fr') : { code: l.code, description: l.code, quantity: l.quantity, unitPrice: 0 };
    });
    const d: Draft = {
      clientId: c?.id,
      name: c?.name ?? r.clientName,
      phone: r.phone ?? c?.phone ?? '',
      address: r.address ?? c?.address ?? '',
      geo: r.address ? undefined : c?.geo,
      date: r.date,
      time: r.time ?? '',
      durationMin: 120,
      items: items.length ? items : r.kind !== 'visite' && r.leftovers.join(' ').trim().length > 3 ? [{ code: '', description: r.leftovers.join(' '), quantity: 1, unitPrice: 0 }] : [],
      quote: true,
      kind: r.kind,
      docType: r.docType,
      dateSaid: r.dateSaid,
      noJob: false,
      addrIncomplete: r.addressIncomplete,
    };
    setFound(null);
    setDone(null);
    proceed(d);
    // Adresse dite → l'adresse exacte qui existe
    if (r.address && !r.addressIncomplete) autoAddress(r.address);
  };

  /** Adresse dite → la première adresse qui existe, appliquée tout de suite (modifiable). */
  const autoAddress = (spoken: string) => {
    void suggestAddresses(spoken).then((list) => list[0]?.resolve()).then((g) => {
      if (g) setDraft((x) => (x && (x.address === spoken || !x.geo) ? { ...x, address: g.label, geo: g.geo, addrIncomplete: false } : x));
    }).catch(() => undefined);
  };

  /** Met à jour le brouillon et pose la prochaine question qui manque (ou montre le résumé). */
  const proceed = (d: Draft) => {
    if (d.docType === 'invoice') d = { ...d, quote: false };
    setDraft(d);
    const next = nextSlot(d);
    setSlot(next);
    setAnswer('');
    if (next) {
      say(QUESTIONS[next](d), () => { if (voiceMode.current && speechSupported()) mic('answer', true); });
    } else {
      say(d.docType === 'invoice' ? 'Parfait. Vérifie, puis crée la facture.' : 'Parfait. Vérifie, puis confirme.');
    }
  };

  liveTurn.current = (r) => void aiTurn('À voix haute…', r);
  const toggleLive = async () => {
    if (liveRef.current) {
      const h = liveRef.current;
      liveRef.current = null;
      setLive(false);
      await h.stop();
      return;
    }
    window.speechSynthesis?.cancel();
    setLive(true);
    try {
      liveRef.current = await startLive({
        company: s?.companyName ?? '',
        assistantName: s?.aiName || undefined,
        today: todayISO(),
        services: services.map((x) => ({ code: x.code, name: x.name, unit: x.unit, price: x.price })),
        clients: () => clientsRef.current.map((c) => ({ id: c.id, name: c.name, address: c.address, phone: c.phone })),
        onResult: (r) => liveTurn.current(r),
        onClose: () => {
          liveRef.current = null;
          setLive(false);
        },
      });
    } catch (e) {
      liveRef.current = null;
      setLive(false);
      const m = e instanceof Error ? e.message : String(e);
      const nm = (e as { name?: string })?.name ?? '';
      const denied = /NotAllowed|Permission|denied/i.test(nm + ' ' + m);
      // L'ancienne app Android bloque le micro de la page même si tu l'as accepté: il faut installer la nouvelle version
      notify(denied && isNative() ? 'Le mode conversation demande la nouvelle version de l’app (réinstalle-la). En attendant, « Commencer à parler » marche.' : denied ? 'Micro refusé: autorise le micro pour l’app.' : 'Mode conversation indisponible: ' + m.slice(0, 160), 'err');
    }
  };

  const mic = (to: 'cmd' | 'answer' = 'cmd', auto = false) => {
    if (listeningRef.current) {
      if (!auto) rec.current?.stop();
      return;
    }
    target.current = to;
    voiceMode.current = true;
    if (to === 'cmd') {
      setHeard('');
      setDone(null);
    } else setAnswer('');
    window.speechSynthesis?.cancel();
    // Écoute intelligente: la voix est transcrite par Gemini (bien plus juste que la dictée du téléphone)
    setHearingHints([...clientsRef.current.map((c) => c.name), ...services.map((x) => x.name)]);
    const useCloud = aiOn && hearingSupported();
    const r = (useCloud ? listenCloud : listen)(
      (text) => (to === 'cmd' ? setHeard(text) : setAnswer(text)),
      (err, text) => {
        listeningRef.current = false;
        setListening(false);
        const t = (text ?? '').trim();
        if (t) {
          // Le texte complet (même la fin dite juste avant « Arrêter »)
          if (to === 'cmd') {
            setHeard(t);
            latest.current.analyse(t);
          } else {
            setAnswer(t);
            latest.current.applyAnswer(t);
          }
        } else if (err && !(auto && /rien entendu/.test(err))) notify(err, 'err');
        else if (!auto) notify('Je n’ai rien entendu. Appuie sur « Commencer à parler », parle, puis « Arrêter ». Tu peux aussi l’écrire.', 'err');
      },
    );
    if (!r) return notify('La dictée n’est pas disponible sur ce navigateur — écris la phrase dans la case.', 'err');
    rec.current = r;
    listeningRef.current = true;
    setListening(true);
  };

  /** Réponse à la question posée → on remplit, puis prochaine question. */
  const applyAnswer = (text: string) => {
    if (!text.trim() || !draft || !slot) return;
    const t = text.trim();
    if (slot === 'name') {
      const r = parseJobCommand(`pour ${t}`, services, clients.map((c) => ({ id: c.id, name: c.name })), todayISO());
      const c = r.clientId ? clients.find((x) => x.id === r.clientId) : undefined;
      const patch: Partial<Draft> = c ? { clientId: c.id, name: c.name, address: draft.address || c.address, geo: draft.address ? draft.geo : c.geo } : { name: r.clientName || capName(t) };
      if (r.address && !draft.address) Object.assign(patch, { address: r.address, addrIncomplete: r.addressIncomplete });
      proceed({ ...draft, ...patch });
      if (r.address && !r.addressIncomplete) autoAddress(r.address);
      return;
    }
    if (slot === 'address') {
      const spoken = t.replace(/^(?:c est |c'est |au |à |a )/i, '').replace(/\b(\d{1,3})[-\s](\d{2,3})\b(?=\s+\D)/, '$1$2');
      // « des Érables » seulement: on complète l'adresse déjà dite
      const full = /^\d/.test(spoken) || !draft.address ? spoken : `${draft.address} ${spoken}`.replace(/\s+/g, ' ');
      proceed({ ...draft, address: full, geo: undefined, addrIncomplete: false });
      autoAddress(full);
      return;
    }
    if (slot === 'job') {
      const r = parseDictation(t, services, []);
      const c = draft.clientId ? clients.find((x) => x.id === draft.clientId) : undefined;
      const items = r.lines.map((l) => lineFromService(services.find((x) => x.code === l.code)!, l.quantity, c?.lang ?? 'fr'));
      if (r.leftovers.length) items.push({ code: '', description: r.leftovers.join(' '), quantity: 1, unitPrice: 0 });
      if (!r.lines.length) notify('Je n’ai pas reconnu de service: vérifie la ligne et le prix.', 'err');
      proceed({ ...draft, items: items.length ? items : [{ code: '', description: t, quantity: 1, unitPrice: 0 }] });
      return;
    }
    // date
    if (/\b(pas de date|plus tard|sais pas|je ne sais pas|aucune|non)\b/i.test(t)) return proceed({ ...draft, dateSaid: true, noJob: true });
    const w = findWhen(wordsToNumbers(t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()), todayISO());
    proceed({ ...draft, date: w.date, time: w.time ?? draft.time, dateSaid: true, noJob: false });
  };

  // Dernières versions des fonctions (le micro les appelle à la fin, après plusieurs rendus)
  const latest = useRef({ analyse, applyAnswer, mic });
  latest.current = { analyse, applyAnswer, mic };

  const create = async () => {
    if (!draft) return;
    if (!draft.clientId && !draft.name.trim()) return notify('Quel est le nom du client?', 'err');
    setBusy(true);
    try {
      const st = await getSettings();
      const now = new Date().toISOString();
      let clientId = draft.clientId;
      if (!clientId) {
        clientId = await db.clients.add({ name: draft.name.trim(), contact: '', email: '', phone: draft.phone.trim(), address: draft.address.trim(), geo: draft.geo, notes: '', createdAt: now });
      } else if (draft.phone && !(await db.clients.get(clientId))?.phone) {
        await db.clients.update(clientId, { phone: draft.phone.trim() });
      }
      const items = draft.items.filter((it) => it.description.trim() || it.unitPrice || it.code);
      const work = items.map((it) => it.description).filter(Boolean).join(' + ');
      const title = work || 'Job';
      const visit = draft.kind === 'visite';
      if (draft.docType === 'invoice') {
        const date = todayISO();
        const number = await takeNextNumber('invoice');
        const invoiceId = await db.docs.add({
          type: 'invoice', number, clientId, date, dueDate: addDays(date, st.paymentTermsDays), jobDate: date, jobAddress: draft.address.trim(), jobGeo: draft.geo, title, items,
          applyTps: st.chargeTaxes, applyTvq: st.chargeTaxes, notes: st.invoiceNotes, status: 'draft', payments: [], createdAt: now, updatedAt: now,
        });
        const total = docTotals({ items, applyTps: st.chargeTaxes, applyTvq: st.chargeTaxes, payments: [] }, st).total;
        setDone({ invoiceId, date, time: '', total, number, visit: false });
        say(`La facture ${number} de ${Math.round(total)} dollars est prête.`);
        setDraft(null);
        setHeard('');
        return;
      }
      if (draft.noJob) {
        const date = todayISO();
        const number = await takeNextNumber('quote');
        const quoteId = await db.docs.add({
          type: 'quote', number, clientId, date, dueDate: addDays(date, st.quoteValidityDays), jobDate: date, jobAddress: draft.address.trim(), jobGeo: draft.geo, title, items,
          applyTps: st.chargeTaxes, applyTvq: st.chargeTaxes, notes: st.quoteNotes, status: 'draft', payments: [], createdAt: now, updatedAt: now,
        });
        const total = docTotals({ items, applyTps: st.chargeTaxes, applyTvq: st.chargeTaxes, payments: [] }, st).total;
        setDone({ quoteId, date, time: '', total, number, visit: false });
        say(`La soumission ${number} est prête.`);
        setDraft(null);
        setHeard('');
        return;
      }
      const jobId = await db.jobs.add({
        ...blankJob(draft.date, clientId), time: draft.time, durationMin: visit ? Math.min(draft.durationMin, 60) : draft.durationMin,
        address: draft.address.trim(), geo: draft.geo, title: visit ? `Visite d’estimation${work ? ` — ${work}` : ''}` : title,
        items: visit ? [] : items, type: visit ? 'estimation' : undefined,
      });
      let quoteId: number | undefined;
      let number: string | undefined;
      if (draft.quote) {
        const date = todayISO();
        number = await takeNextNumber('quote');
        const q: Doc = {
          type: 'quote', number, clientId, date, dueDate: addDays(date, st.quoteValidityDays), jobDate: draft.date,
          jobAddress: draft.address.trim(), jobGeo: draft.geo, title, items,
          applyTps: st.chargeTaxes, applyTvq: st.chargeTaxes, notes: st.quoteNotes, status: 'draft', payments: [], jobId, createdAt: now, updatedAt: now,
        };
        quoteId = await db.docs.add(q);
      }
      const total = docTotals({ items, applyTps: st.chargeTaxes, applyTvq: st.chargeTaxes, payments: [] }, st).total;
      setDone({ jobId, quoteId, date: draft.date, time: draft.time, total, number, visit: draft.kind === 'visite' });
      setDraft(null);
      setHeard('');
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const invoice = async () => {
    if (!done) return;
    try {
      if (done.invoiceId) return nav(`/doc/${done.invoiceId}`);
      if (!done.jobId) return nav(`/doc/${await quoteToInvoice((await db.docs.get(done.quoteId!))!)}`);
      // Après une visite, la facture vient de la soumission; sinon, de la job
      if (done.quoteId && done.visit) {
        return nav(`/doc/${await quoteToInvoice((await db.docs.get(done.quoteId))!)}`);
      }
      nav(`/doc/${await jobToInvoice(done.jobId!)}`);
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };

  const total = draft ? draft.items.reduce((a, it) => a + lineAmount(it), 0) : 0;
  const when = (d: string, t: string) => `${new Date(d + 'T12:00:00').toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}${t ? ` à ${Number(t.slice(0, 2))} h${t.slice(3) !== '00' ? ` ${t.slice(3)}` : ''}` : ''}`;

  return (
    <div className="vj">
      <div className="page-head">
        <div>
          <div className="eyebrow"><Sparkles size={14} /> Assistant</div>
          <h1>Qu’est-ce que je fais pour toi?</h1>
        </div>
      </div>

      {aiReady && !aiOn && aiPause && (
        <div className="vj-ai-pause">
          <span><b>Assistant de base</b> — l’IA est en pause: {aiPause.why}</span>
          <button className="btn small" onClick={reconnectAi}><RotateCcw size={13} /> Reconnecter l’IA</button>
        </div>
      )}
      <div ref={topRef} style={{ scrollMarginTop: 72 }} />
      {prop && (
        <div className="card vj-prop">
          <div className="vj-bubble">{prop.say}</div>
          {(prop.confirm || prop.next?.length || prop.links?.length || prop.relance) && (
            <div className="vj-done-actions">
              {prop.confirm && <button className="btn accent big" disabled={busy} onClick={() => void doStep(prop.confirm!)}><Check size={18} /> {prop.confirm.label}</button>}
              {prop.next?.map((n) => <button key={n.label} className="btn accent" disabled={busy} onClick={() => void doStep(n)}>{n.label}</button>)}
              {prop.relance && <button className="btn accent" onClick={() => setRelanceDoc(prop.relance)}>Texto ou courriel de relance</button>}
              {prop.links?.map((l) => <Link key={l.to} className="btn" to={l.to}>{l.label}</Link>)}
            </div>
          )}
          <button className="btn small" style={{ marginTop: 10 }} onClick={() => { setProp(null); setHeard(''); resetAi(); }}>{prop.confirm ? 'Annuler' : 'Autre chose'}</button>
        </div>
      )}
      {msg && (
        <div className="card vj-prop">
          <h2 style={{ marginTop: 0 }}>Message pour {msg.name}</h2>
          <label className="field">Courriel — objet<input value={msg.subject} onChange={(e) => setMsg({ ...msg, subject: e.target.value })} /></label>
          <label className="field">Message<textarea rows={6} value={msg.text} onChange={(e) => setMsg({ ...msg, text: e.target.value })} /></label>
          <div className="vj-done-actions">
            {msg.phone && <a className="btn accent big" href={smsLink(msg.phone, msg.text)}>Envoyer par texto</a>}
            {msg.email && <a className="btn accent" href={`mailto:${msg.email}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.text)}`}>Envoyer par courriel</a>}
            {!msg.phone && !msg.email && <span className="small muted">Ce client n’a ni téléphone ni courriel: ajoute-en un dans sa fiche.</span>}
          </div>
          <button className="btn small" style={{ marginTop: 10 }} onClick={() => { setMsg(null); setHeard(''); resetAi(); }}>Annuler</button>
        </div>
      )}
      {prop?.todo && <ConfirmList limit={8} />}
      {relanceDoc && <RelanceModal doc={relanceDoc} client={clients.find((c) => c.id === relanceDoc.clientId)} onClose={() => setRelanceDoc(null)} />}

      {!draft && !done && (
        <div className="card vj-mic">
          {aiOn && (
            <div className="vj-ai-tag">
              <span><Sparkles size={13} /> Assistant IA</span>
              {convo.length > 0 && <button className="btn ghost small" onClick={resetAi}><RotateCcw size={13} /> Nouvelle demande</button>}
            </div>
          )}
          {convo.length > 0 && (
            <div className="vj-convo" aria-live="polite">
              {convo.slice(-8).map((m, i) => <div key={i} className={`vj-msg ${m.me ? 'me' : ''}`}>{m.text}</div>)}
              {thinking && <div className="vj-msg typing" aria-label="Je réfléchis"><i /><i /><i /></div>}
            </div>
          )}
          {aiOn && liveSupported() && (
            <button type="button" className={`btn ${live ? 'danger' : 'accent'} big`} onClick={() => void toggleLive()}>
              <Mic size={18} /> {live ? 'Terminer la conversation' : 'Parler librement'}
            </button>
          )}
          {live && <div className="vj-hint">Je t’écoute — parle naturellement, tu peux m’interrompre.</div>}
          {speechSupported() && !live && (
            <MicButton listening={listening} onClick={() => mic('cmd')} />
          )}
          <div className="vj-hint">{listening ? 'J’écoute… prends ton temps, appuie sur « Arrêter » quand t’as fini.' : speechSupported() ? 'Dis tout d’un coup, ou écris-le :' : 'Écris la phrase :'}</div>
          {!prop && !convo.length && <div className="small muted">Une job: {EXAMPLE}</div>}
          <div className={`vj-ideas ${prop || convo.length ? 'hide' : ''}`}>
            {IDEAS.map((t) => <button key={t} onClick={() => { setHeard(t); analyse(t); }}>{t}</button>)}
          </div>
          <textarea className="vj-text" value={heard} placeholder={convo.length ? 'Ta réponse…' : 'Dis ou écris ce que tu veux: planifier, facturer, relancer, une dépense…'} onChange={(e) => setHeard(e.target.value)} rows={convo.length ? 2 : 3}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && heard.trim() && !thinking) { e.preventDefault(); analyse(heard); } }} />
          {!listening && heard.trim() && <button className="btn accent big" disabled={thinking} onClick={() => analyse(heard)}><Check size={18} /> {convo.length ? 'Envoyer' : 'Analyser'}</button>}
        </div>
      )}

      {draft && slot && (
        <div className="card vj-ask">
          <div className="vj-sofar">
            {(draft.clientId || draft.name) && <span><UserPlus size={13} /> {draft.name}</span>}
            {draft.address && !draft.addrIncomplete && <span><MapPin size={13} /> {draft.address}</span>}
            {hasWork(draft) && <span><ClipboardList size={13} /> {draft.items.filter((it) => it.description).map((it) => it.description).join(', ')}</span>}
          </div>
          <div className="vj-bubble">{QUESTIONS[slot](draft)}</div>
          {speechSupported() && (
            <MicButton small listening={listening} onClick={() => mic('answer')} startLabel="Répondre" />
          )}
          <div className="small muted">{listening ? 'J’écoute…' : EXAMPLES[slot]}</div>
          <textarea className="vj-text" rows={2} value={answer} placeholder="Ta réponse…" onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyAnswer(answer); } }} />
          <div className="row" style={{ justifyContent: 'center' }}>
            {!listening && answer.trim() && <button className="btn accent" onClick={() => applyAnswer(answer)}><Check size={17} /> OK</button>}
            {slot === 'job' && draft.kind === 'visite' && <button className="btn" onClick={() => proceed({ ...draft, quote: false, items: [{ code: '', description: 'Visite d’estimation', quantity: 1, unitPrice: 0 }] })}>Pas de soumission pour l’instant</button>}
            {slot === 'date' && <button className="btn" onClick={() => proceed({ ...draft, dateSaid: true, noJob: true })}>Pas de date</button>}
            {(slot === 'address' || slot === 'name') && <button className="btn" onClick={() => setSlot(null)}>Passer</button>}
          </div>
        </div>
      )}

      {draft && !slot && (
        <>
          <div className="card">
            {heard.trim() && <div className="vj-said small muted">« {heard} »</div>}
            <h2 style={{ marginTop: 8 }}>Ce que j’ai compris {draft.kind === 'visite' && <span className="badge blue">visite d’estimation</span>}</h2>
            <div className="form-grid">
              <div className="field full">
                <span className="row" style={{ gap: 6 }}>Client {draft.clientId ? <span className="badge green">déjà dans tes clients</span> : <span className="badge blue"><UserPlus size={11} /> nouveau client</span>}</span>
                {draft.clientId
                  ? <ClientPicker value={draft.clientId} onChange={(id) => { const c = clients.find((x) => x.id === id); up({ clientId: id, name: c?.name ?? '', address: draft.address || c?.address || '', geo: draft.address ? draft.geo : c?.geo }); }} />
                  : <input id="vj-name" value={draft.name} placeholder="Nom du client" onChange={(e) => up({ name: e.target.value })} />}
              </div>
              {!draft.clientId && <label className="field">Téléphone<input type="tel" value={draft.phone} onChange={(e) => up({ phone: e.target.value })} /></label>}
              <label className="field full">Adresse des travaux
                <AddressInput value={draft.address} onChange={(v) => { up({ address: v, geo: undefined }); setFound(null); }} onPick={(label, geo) => { up({ address: label, geo }); setFound(null); }} />
              </label>
              {found && found.label !== draft.address && (
                <button className="vj-found full" onClick={() => { up({ address: found.label, geo: found.geo }); setFound(null); }}>
                  <MapPin size={16} /> <span>Adresse trouvée : <strong>{found.label}</strong></span> <span className="vj-use">Utiliser</span>
                </button>
              )}
              {!draft.noJob && (
                <>
                  <label className="field">Journée<input type="date" value={draft.date} onChange={(e) => e.target.value && up({ date: e.target.value })} /></label>
                  <label className="field">Heure<input type="time" value={draft.time} onChange={(e) => up({ time: e.target.value })} /></label>
                  <label className="field">Durée
                    <select value={draft.durationMin} onChange={(e) => up({ durationMin: Number(e.target.value) })}>
                      {[30, 60, 90, 120, 180, 240, 360, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
                    </select>
                  </label>
                </>
              )}
            </div>
          </div>
          <div className="card">
            <h2>{draft.kind === 'visite' ? 'Travaux pour la soumission' : 'Travaux'}</h2>
            <LineItems items={draft.items} services={services} onChange={(items) => up({ items })} />
            <div className="vj-total"><span>Total avant taxes</span><b>{money(total)}</b></div>
          </div>
          {draft.docType !== 'invoice' && !draft.noJob && <label className="check" style={{ margin: '0 4px 12px' }}><input type="checkbox" checked={draft.quote} onChange={(e) => up({ quote: e.target.checked })} /> Préparer la soumission en même temps</label>}
          <div className="vj-actions">
            <button className="btn" onClick={() => { setDraft(null); resetAi(); }}><RotateCcw size={16} /> Recommencer</button>
            <button className="btn accent big" disabled={busy} onClick={() => void create()}><CalendarCheck size={18} /> {busy ? '…' : draft.docType === 'invoice' ? 'Créer la facture' : draft.noJob ? 'Créer la soumission' : draft.quote ? 'Planifier + soumission' : 'Planifier la job'}</button>
          </div>
        </>
      )}

      {done && (
        <div className="card vj-done">
          <div className="vj-ok"><Check size={26} /></div>
          <h2>{done.invoiceId ? 'Facture prête' : !done.jobId ? 'Soumission prête' : done.visit ? 'Visite planifiée' : 'C’est planifié'}</h2>
          <p className="muted">
            {done.invoiceId ? <>Facture <strong>{done.number}</strong> de {money(done.total)} prête à envoyer.</>
              : !done.jobId ? <>Soumission <strong>{done.number}</strong> de {money(done.total)} prête à envoyer.</>
              : <>{done.visit ? 'Visite' : 'Job'} le <strong>{when(done.date, done.time)}</strong>{done.quoteId ? <> · soumission <strong>{done.number}</strong> de {money(done.total)} prête à envoyer</> : null}.</>}
          </p>
          <div className="vj-done-actions">
            {done.invoiceId && <button className="btn accent" onClick={() => nav(`/doc/${done.invoiceId}`)}><FileText size={17} /> Voir et envoyer la facture</button>}
            {done.quoteId && <button className="btn accent" onClick={() => nav(`/doc/${done.quoteId}`)}><ClipboardList size={17} /> Voir et envoyer la soumission</button>}
            {!done.invoiceId && <button className="btn" onClick={() => void invoice()}><FileText size={17} /> Faire la facture</button>}
            {done.jobId && <button className="btn" onClick={() => nav(`/agenda?d=${done.date}&v=jour`)}><CalendarDays size={17} /> Voir l’agenda</button>}
            <button className="btn" onClick={() => { setDone(null); resetAi(); }}><Mic size={17} /> Autre chose</button>
          </div>
          {!s.homeAddress && <p className="small muted" style={{ marginTop: 10 }}>Ajoute ton adresse dans Paramètres pour que les km se calculent tout seuls.</p>}
        </div>
      )}
    </div>
  );
}
