import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Mic, PhoneOff, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { jobToInvoice, smsLink } from '../lib/agenda';
import { AiAssistant, aiConfigured, aiErrorMessage, type AiClientEdit, type AiDoc, type AiMessage, type AiResult } from '../lib/ai';
import { aiItems, createFromAi, type AiCreated } from '../lib/aiCreate';
import { propose, type Proposal, type Step } from '../lib/assistantActions';
import { db, EXPENSE_CATEGORIES, type Client, type Doc, type LineItem } from '../lib/db';
import { saveReceipt, type Place } from '../lib/aiExpense';
import { useSettings } from '../lib/hooks';
import { buildTodos, snoozeTodo, type Todo } from '../lib/todo';
import { docTotals, money, todayISO } from '../lib/utils';
import leaPhoto from '../assets/lea.png';
import { listen, speechSupported, type Listening } from '../lib/speech';
import { ClientPicker } from './ClientPicker';
import { TaxMode } from './TaxMode';
import { RelanceModal } from './RelanceModal';
import { errMsg, useToast } from './Toast';

/** Léa, l'agente administrative: sa photo ne change pas. */
export function LeaAvatar({ size = 48 }: { size?: number }) {
  return <img className="lea-av" src={leaPhoto} width={size} height={size} alt="Léa" />;
}

type Msg = { me?: boolean; text: string; message?: AiMessage & { name: string; phone: string; email: string; subject: string }; edit?: { client: Client; edit: AiClientEdit; done?: boolean }; handoff?: { ask: string; result: AiResult }; prop?: Proposal; doc?: DocDraft; exp?: ExpDraft };

interface ExpDraft { vendor: string; date: string; total: number; category: string; shopAddress: string; from: Place; to: Place; photo?: { data: string; mimeType: string; url: string }; saved?: { summary: string; expenseId: number } }

interface DocDraft { ai: AiDoc; ask: string; detailed: boolean; tax: { applyTps: boolean; applyTvq: boolean; taxIncluded: boolean }; clientId?: number; name: string; phone: string; address: string; date: string; time: string; hasDate: boolean; items: LineItem[]; created?: AiCreated }
const DOC_LABEL: Record<AiDoc['type'], string> = { facture: 'Facture', soumission: 'Soumission', job: 'Job à planifier', visite: 'Visite d’estimation' };

const QUICK = [
  { label: 'Relancer les impayés', ask: 'Relance mes factures en retard' },
  { label: 'Planifier une job', ask: 'Je veux planifier une job' },
  { label: 'Faire une soumission', ask: 'Je veux faire une soumission' },
  { label: 'Ma journée', ask: 'Quel est mon horaire aujourd’hui?' },
];
const KINDS = ['retard', 'soumission', 'facturer'];
const ACTION: Record<string, string> = { retard: 'Relancer', soumission: 'Relancer', facturer: 'Facturer' };
const LABELS: Record<string, string> = { name: 'Nom', contact: 'Contact', phone: 'Téléphone', email: 'Courriel', address: 'Adresse', notes: 'Notes' };

/** Petite bulle de chat avec Léa: elle accueille avec le travail de bureau en attente et fait tout ce qui touche à l'app. */
export function LeaChat() {
  const s = useSettings();
  const nav = useNavigate();
  const loc = useLocation();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [relance, setRelance] = useState<Todo | null>(null);
  const [relanceDoc, setRelanceDoc] = useState<Doc | null>(null);
  const [photo, setPhoto] = useState<{ mimeType: string; data: string; url: string } | null>(null);
  const ai = useRef<AiAssistant | null>(null);
  const [call, setCall] = useState<'off' | 'on'>('off');
  const [phase, setPhase] = useState<'listen' | 'think' | 'speak'>('listen');
  const [heard, setHeard] = useState('');
  const callRef = useRef(false);
  const listenRef = useRef<Listening | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const services = useLiveQuery(() => db.services.orderBy('order').toArray(), []) ?? [];
  const clients = useLiveQuery(() => db.clients.toArray(), []) ?? [];
  const clientsRef = useRef(clients);
  clientsRef.current = clients;
  const todos = useLiveQuery(async () => {
    await Promise.all([db.jobs.count(), db.docs.count(), db.settings.get('main')]);
    return (await buildTodos()).filter((t) => KINDS.includes(t.kind));
  }, []);
  const jobsToday = useLiveQuery(async () => {
    const [jobs, cl] = await Promise.all([db.jobs.where('date').equals(todayISO()).toArray(), db.clients.toArray()]);
    const names = new Map(cl.map((c) => [c.id, c.name]));
    return jobs.filter((j) => j.status === 'planifie').sort((a, b) => (a.time || '').localeCompare(b.time || '')).map((j) => `${j.time ? `${Number(j.time.slice(0, 2))} h${j.time.slice(3) !== '00' ? ' ' + j.time.slice(3) : ''} ` : ''}${names.get(j.clientId) ?? 'Client'}${j.title ? ` — ${j.title}` : ''}`);
  }, []);
  // Les jobs d'aujourd'hui: sert à « tu pars d'où / tu t'en vas où »
  const dayJobs = useLiveQuery(async () => {
    const [jobs, cl] = await Promise.all([db.jobs.where('date').equals(todayISO()).toArray(), db.clients.toArray()]);
    const names = new Map(cl.map((c) => [c.id, c.name]));
    return jobs.filter((j) => j.status !== 'annule').sort((a, b) => (a.time || '').localeCompare(b.time || '')).map((j) => ({ id: j.id!, label: names.get(j.clientId) ?? 'Client' }));
  }, []) ?? [];
  const on = aiConfigured(s.aiAssistant);
  const first = (s.ownerName || '').split(' ')[0];

  // Léa lance la conversation à l'ouverture de l'app (une fois par session)
  useEffect(() => {
    if (!todos?.length && !jobsToday?.length) return;
    try {
      if (sessionStorage.getItem('lea-teaser')) return;
      sessionStorage.setItem('lea-teaser', '1');
    } catch { /* tant pis */ }
    setTeaser(true);
  }, [todos, jobsToday]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, open, busy]);
  useEffect(() => { setOpen(false); hangUpRef.current(); }, [loc.pathname]);

  const showResult = async (r: AiResult, ask: string, img?: { data: string; mimeType: string; url: string } | null): Promise<string> => {
    let spoken = r.text;
    if (r.kind === 'say') setMsgs((m) => [...m, { text: r.text }]);
    else if (r.kind === 'message') {
      const c = clientsRef.current.find((x) => x.id === r.message.clientId);
      if (!c) setMsgs((m) => [...m, { text: (spoken = 'Je ne trouve pas ce client. Redis-moi son nom.') }]);
      else {
        spoken = r.text || `Voici le message pour ${c.name}. Change ce que tu veux, puis envoie-le.`;
        setMsgs((m) => [...m, { text: spoken, message: { ...r.message, name: c.name, phone: c.phone, email: c.email, subject: r.message.subject ?? `Message de ${s.companyName}` } }]);
      }
    } else if (r.kind === 'client') {
      const c = clientsRef.current.find((x) => x.id === r.edit.clientId);
      if (!c) setMsgs((m) => [...m, { text: (spoken = 'Je ne trouve pas ce client. Redis-moi son nom.') }]);
      else {
        spoken = r.text || `Je change la fiche de ${c.name}. Confirme.`;
        setMsgs((m) => [...m, { text: spoken, edit: { client: c, edit: r.edit } }]);
      }
    } else if (r.kind === 'intent' && r.intent.kind === 'depense') {
      const i = r.intent;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(i.date ?? '') ? i.date! : todayISO();
      const draft: ExpDraft = { vendor: i.vendor ?? '', date, total: i.amount ?? 0, category: i.category && (EXPENSE_CATEGORIES as readonly string[]).includes(i.category) ? i.category : 'Autre', shopAddress: '', from: { kind: 'maison' }, to: { kind: 'aucun' }, photo: img ?? undefined };
      spoken = r.text || (img ? 'J’ai lu ton reçu. Vérifie, dis-moi d’où tu partais et où tu t’en vas, puis enregistre.' : 'Voici la dépense. Vérifie, dis-moi d’où tu partais et où tu t’en vas, puis enregistre.');
      setMsgs((m) => [...m, { text: spoken, exp: draft }]);
    } else if (r.kind === 'intent') {
      const p = await propose(r.intent);
      spoken = p.say || r.text;
      setMsgs((m) => [...m, { text: spoken, prop: p }]);
    } else if (r.kind === 'doc') {
      const a = r.doc;
      const c = a.clientId ? clientsRef.current.find((x) => x.id === a.clientId) : undefined;
      const draft: DocDraft = { ai: a, ask, detailed: !!a.detailed, tax: { applyTps: !!s.chargeTaxes, applyTvq: !!s.chargeTaxes, taxIncluded: false }, clientId: c?.id, name: c?.name ?? a.name ?? '', phone: a.phone ?? c?.phone ?? '', address: a.address ?? c?.address ?? '', date: a.date ?? todayISO(), time: a.time ?? '', hasDate: !!a.date, items: aiItems(a, services, c?.lang ?? 'fr') };
      spoken = r.text || (a.type === 'facture' ? 'Voici la facture. Corrige ce que tu veux, puis confirme.' : a.type === 'soumission' ? 'Voici la soumission. Corrige ce que tu veux, puis confirme.' : 'Voici ce que je planifie. Corrige ce que tu veux, puis confirme.');
      setMsgs((m) => [...m, { text: spoken, doc: draft }]);
    } else {
      spoken = r.text || 'C’est prêt. Je te l’ouvre pour que tu confirmes.';
      setMsgs((m) => [...m, { text: spoken, handoff: { ask, result: r } }]);
    }
    return spoken;
  };

  /** Une phrase (écrite ou dite) → réponse de Léa. Renvoie ce que Léa dit, pour la voix. */
  const send = async (override?: string): Promise<string> => {
    const text = (override ?? input).trim() || (photo ? 'Voici une photo. Qu’est-ce que je dois en faire?' : '');
    if (!text || busy) return '';
    const img = photo;
    setInput('');
    setPhoto(null);
    setMsgs((m) => [...m, { me: true, text: img ? `📷 ${text}` : text }]);
    setBusy(true);
    try {
      if (!ai.current) {
        ai.current = new AiAssistant({
          company: s.companyName,
          services: services.map((x) => ({ code: x.code, name: x.name, unit: x.unit, price: x.price })),
          clients: () => clientsRef.current.map((c) => ({ id: c.id, name: c.name, address: c.address, phone: c.phone })),
          today: todayISO(),
          model: s.aiModel || undefined,
        });
      }
      const r = await ai.current.send(text, img ? { mimeType: img.mimeType, data: img.data } : undefined);
      return await showResult(r, text, img);
    } catch (e) {
      const m = aiErrorMessage(e).replace(' J’utilise l’assistant de base.', '');
      setMsgs((all) => [...all, { text: m }]);
      ai.current = null;
      return 'Oups, j’ai eu un problème. Peux-tu répéter?';
    } finally {
      setBusy(false);
    }
  };

  // ===== Appel vocal à tour de rôle: Léa écoute, réfléchit, répond, puis réécoute (pas de micro ouvert pendant qu'elle parle → pas d'écho) =====
  const hangUpRef = useRef<() => void>(() => {});
  const hangUp = () => {
    callRef.current = false;
    try { listenRef.current?.stop(); } catch { /* déjà arrêté */ }
    listenRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* rien à couper */ }
    setHeard('');
    setCall('off');
  };
  hangUpRef.current = hangUp;
  const speak = (text: string) => new Promise<void>((done) => {
    let ended = false;
    const fin = () => { if (!ended) { ended = true; done(); } };
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/’/g, "'"));
      u.lang = 'fr-CA';
      u.rate = 1.03;
      u.onend = fin;
      u.onerror = fin;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      setTimeout(fin, 1500 + text.length * 80); // certains Android n'annoncent jamais la fin
    } catch { fin(); }
  });
  const voiceTurn = async (text: string) => {
    setPhase('think');
    const spoken = await send(text);
    if (!callRef.current) return;
    if (spoken) {
      setPhase('speak');
      await speak(spoken);
    }
    if (callRef.current) listenTurn();
  };
  const listenTurn = () => {
    if (!callRef.current) return;
    setPhase('listen');
    setHeard('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const l = listen(
      (t, fin) => {
        setHeard(t);
        if (timer) clearTimeout(timer);
        // On considère la phrase finie après une petite pause de silence
        if (t) timer = setTimeout(() => listenRef.current?.stop(), fin ? 650 : 1300);
      },
      (err, text) => {
        if (timer) clearTimeout(timer);
        listenRef.current = null;
        setHeard('');
        if (!callRef.current) return;
        if (text) return void voiceTurn(text);
        if (err && /Micro refusé|Dictée/.test(err)) {
          setMsgs((m) => [...m, { text: err }]);
          return hangUp();
        }
        setTimeout(listenTurn, 400);
      },
    );
    listenRef.current = l;
    if (!l) {
      setMsgs((m) => [...m, { text: 'La reconnaissance vocale n’est pas disponible ici. Écris-moi, ça marche aussi.' }]);
      hangUp();
    }
  };
  const toggleCall = async () => {
    if (call !== 'off') return hangUp();
    if (!speechSupported()) return void setMsgs((m) => [...m, { text: 'Ton appareil ne permet pas la conversation vocale ici. Écris-moi, ça marche aussi.' }]);
    callRef.current = true;
    setCall('on');
    setPhase('speak');
    await speak('Allô, c’est Léa. Je t’écoute.');
    if (callRef.current) listenTurn();
  };

  const confirmEdit = async (i: number) => {
    const m = msgs[i];
    if (!m.edit) return;
    const { clientId, ...fields } = m.edit.edit;
    const changes = Object.entries(fields).filter(([, v]) => v !== undefined);
    const patch: Record<string, unknown> = Object.fromEntries(changes);
    if (fields.address) patch.geo = undefined;
    try {
      await db.clients.update(clientId, patch);
      setMsgs((all) => all.map((x, j) => (j === i && x.edit ? { ...x, edit: { ...x.edit, done: true } } : x)));
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };

  const patchDoc = (i: number, f: (d: DocDraft) => DocDraft) => setMsgs((all) => all.map((x, j) => (j === i && x.doc ? { ...x, doc: f(x.doc) } : x)));
  const confirmDoc = async (i: number) => {
    const d = msgs[i]?.doc;
    if (!d || d.created) return;
    setBusy(true);
    try {
      const created = await createFromAi({ type: d.ai.type, clientId: d.clientId, name: d.name, phone: d.phone, address: d.address, date: d.date, time: d.time, hasDate: d.hasDate, items: d.items, ask: d.ask, detailed: d.detailed, tax: d.tax });
      patchDoc(i, (x) => ({ ...x, created }));
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const patchExp = (i: number, f: (d: ExpDraft) => ExpDraft) => setMsgs((all) => all.map((x, j) => (j === i && x.exp ? { ...x, exp: f(x.exp) } : x)));
  const confirmExp = async (i: number) => {
    const d = msgs[i]?.exp;
    if (!d || d.saved) return;
    if (!(d.total > 0)) return notify('Entre le montant du reçu.', 'err');
    setBusy(true);
    try {
      const saved = await saveReceipt({ vendor: d.vendor, date: d.date, total: d.total, category: d.category, shopAddress: d.shopAddress, from: d.from, to: d.to, photo: d.photo });
      patchExp(i, (x) => ({ ...x, saved }));
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const runStep = async (step: Step) => {
    setBusy(true);
    try {
      const o = await step.run();
      setMsgs((m) => [...m, { text: o.say, prop: o }]);
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async (f: File) => {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.8);
    setPhoto({ mimeType: 'image/jpeg', data: url.split(',')[1], url });
  };

  const doTodo = async (t: Todo) => {
    try {
      if (t.kind === 'facturer') {
        setOpen(false);
        nav(`/doc/${await jobToInvoice(t.job!.id!)}`);
      } else setRelance(t);
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };

  const count = todos?.length ?? 0;
  const greet = count
    ? `Salut${first ? ` ${first}` : ''}! J’ai ${count === 1 ? 'une chose' : `${count} choses`} à te signaler au bureau:`
    : `Salut${first ? ` ${first}` : ''}! Rien d’urgent au bureau. Qu’est-ce que je peux faire pour toi?`;

  return (
    <>
      {!open && teaser && (count > 0 || !!jobsToday?.length) && (
        <div className="lea-teaser">
          <button className="lea-teaser-x" aria-label="Fermer" onClick={() => setTeaser(false)}><X size={13} /></button>
          <button className="lea-teaser-txt" onClick={() => { setTeaser(false); setOpen(true); }}>{count > 0 ? greet.replace(' à te signaler au bureau:', ' à régler. Je te montre?') : `Salut${first ? ' ' + first : ''}! Ta journée est prête. Je te la montre?`}</button>
        </div>
      )}
      {!open && (
        <button className="lea-bubble" aria-label="Parler à Léa" title="Parler à Léa" onClick={() => { setTeaser(false); setOpen(true); }}>
          <LeaAvatar size={56} />
          {count > 0 && <i className="lea-badge">{count}</i>}
        </button>
      )}
      {open && (
        <section className="lea-panel" aria-label="Chat avec Léa">
          <header className="lea-head">
            <LeaAvatar size={38} />
            <div><strong>Léa</strong><small>Agente administrative</small></div>
            <button className="icon-btn" aria-label="Fermer" onClick={() => { hangUp(); setOpen(false); }}><X size={18} /></button>
          </header>
          <div className="lea-body">
            <div className="lea-msg">{greet}</div>
            {!!jobsToday?.length && <div className="lea-msg"><b>Ta journée</b>{jobsToday.map((j, i) => <div key={i} className="small">• {j}</div>)}</div>}
            {todos?.slice(0, 6).map((t) => (
              <div key={t.key} className="lea-todo">
                <div><b>{t.title}</b><div className="small muted">{t.sub}</div></div>
                <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <button className="btn small accent" onClick={() => void doTodo(t)}>{ACTION[t.kind]}</button>
                  <button className="btn small" onClick={() => void snoozeTodo(t.key, 3)}>Plus tard</button>
                </div>
              </div>
            ))}
            {msgs.map((m, i) => (
              <div key={i} className={`lea-msg ${m.me ? 'me' : ''}`}>
                {m.text}
                {m.message && (
                  <div className="lea-card">
                    <label className="field">Objet (courriel)<input value={m.message.subject} onChange={(e) => setMsgs((all) => all.map((x, j) => (j === i && x.message ? { ...x, message: { ...x.message, subject: e.target.value } } : x)))} /></label>
                    <textarea rows={5} value={m.message.text} onChange={(e) => setMsgs((all) => all.map((x, j) => (j === i && x.message ? { ...x, message: { ...x.message, text: e.target.value } } : x)))} />
                    <div className="row" style={{ gap: 6 }}>
                      {m.message.phone && <a className="btn small accent" href={smsLink(m.message.phone, m.message.text)}>Texto</a>}
                      {m.message.email && <a className="btn small accent" href={`mailto:${m.message.email}?subject=${encodeURIComponent(m.message.subject)}&body=${encodeURIComponent(m.message.text)}`}>Courriel</a>}
                      {!m.message.phone && !m.message.email && <span className="small muted">Ce client n’a ni téléphone ni courriel.</span>}
                    </div>
                  </div>
                )}
                {m.edit && (
                  <div className="lea-card">
                    {Object.entries(m.edit.edit).filter(([k, v]) => k !== 'clientId' && v !== undefined).map(([k, v]) => <div key={k} className="small"><b>{LABELS[k]}:</b> {String(v)}</div>)}
                    {m.edit.done ? <span className="badge green">Fait</span> : <button className="btn small accent" onClick={() => void confirmEdit(i)}>Confirmer le changement</button>}
                  </div>
                )}
                {m.prop && (m.prop.confirm || m.prop.next?.length || m.prop.links?.length || m.prop.relance) && (
                  <div className="lea-card">
                    {m.prop.confirm && <button className="btn small accent" disabled={busy} onClick={() => void runStep(m.prop!.confirm!)}>{m.prop.confirm.label}</button>}
                    {m.prop.next?.map((n) => <button key={n.label} className="btn small accent" disabled={busy} onClick={() => void runStep(n)}>{n.label}</button>)}
                    {m.prop.relance && <button className="btn small accent" onClick={() => setRelanceDoc(m.prop!.relance!)}>Texto ou courriel de relance</button>}
                    {m.prop.links?.map((l) => <Link key={l.to} className="btn small" to={l.to} onClick={() => setOpen(false)}>{l.label}</Link>)}
                  </div>
                )}
                {m.exp && (
                  <div className="lea-card lea-exp">
                    <div className="lea-doc-h"><b>Reçu / dépense</b></div>
                    {m.exp.photo && <img className="lea-exp-photo" src={m.exp.photo.url} alt="Reçu" />}
                    {!m.exp.saved && (
                      <>
                        <div className="lea-doc-row">
                          <label className="field">Commerce<input value={m.exp.vendor} placeholder="ex.: Shell" onChange={(e) => patchExp(i, (x) => ({ ...x, vendor: e.target.value }))} /></label>
                          <label className="field">Total ($)<input type="number" inputMode="decimal" value={m.exp.total || ''} onChange={(e) => patchExp(i, (x) => ({ ...x, total: Number(e.target.value) }))} /></label>
                        </div>
                        <div className="lea-doc-row">
                          <label className="field">Date<input type="date" value={m.exp.date} onChange={(e) => patchExp(i, (x) => ({ ...x, date: e.target.value }))} /></label>
                          <label className="field">Catégorie<select value={m.exp.category} onChange={(e) => patchExp(i, (x) => ({ ...x, category: e.target.value }))}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
                        </div>
                        <div className="lea-q">Tu pars d’où?</div>
                        <div className="lea-chips-row">
                          <button type="button" className={`chip-btn ${m.exp.from.kind === 'maison' ? 'on' : ''}`} onClick={() => patchExp(i, (x) => ({ ...x, from: { kind: 'maison' } }))}>Mon domicile</button>
                          {dayJobs.map((j) => <button key={j.id} type="button" className={`chip-btn ${m.exp!.from.kind === 'job' && m.exp!.from.jobId === j.id ? 'on' : ''}`} onClick={() => patchExp(i, (x) => ({ ...x, from: { kind: 'job', jobId: j.id } }))}>Job de {j.label}</button>)}
                          <button type="button" className={`chip-btn ${m.exp.from.kind === 'autre' ? 'on' : ''}`} onClick={() => patchExp(i, (x) => ({ ...x, from: { kind: 'autre', address: '' } }))}>Ailleurs</button>
                          <button type="button" className={`chip-btn ${m.exp.from.kind === 'aucun' ? 'on' : ''}`} onClick={() => patchExp(i, (x) => ({ ...x, from: { kind: 'aucun' } }))}>Aucun trajet</button>
                        </div>
                        {m.exp.from.kind === 'autre' && <input value={m.exp.from.address} placeholder="Adresse de départ" aria-label="Adresse de départ" onChange={(e) => patchExp(i, (x) => ({ ...x, from: { kind: 'autre', address: e.target.value } }))} />}
                        <div className="lea-q">Tu t’en vas où?</div>
                        <div className="lea-chips-row">
                          {dayJobs.map((j) => <button key={j.id} type="button" className={`chip-btn ${m.exp!.to.kind === 'job' && m.exp!.to.jobId === j.id ? 'on' : ''}`} onClick={() => patchExp(i, (x) => ({ ...x, to: { kind: 'job', jobId: j.id } }))}>Job de {j.label}</button>)}
                          <button type="button" className={`chip-btn ${m.exp.to.kind === 'maison' ? 'on' : ''}`} onClick={() => patchExp(i, (x) => ({ ...x, to: { kind: 'maison' } }))}>Mon domicile</button>
                          <button type="button" className={`chip-btn ${m.exp.to.kind === 'autre' ? 'on' : ''}`} onClick={() => patchExp(i, (x) => ({ ...x, to: { kind: 'autre', address: '' } }))}>Ailleurs</button>
                          <button type="button" className={`chip-btn ${m.exp.to.kind === 'aucun' ? 'on' : ''}`} onClick={() => patchExp(i, (x) => ({ ...x, to: { kind: 'aucun' } }))}>Nulle part</button>
                        </div>
                        {m.exp.to.kind === 'autre' && <input value={m.exp.to.address} placeholder="Adresse d’arrivée" aria-label="Adresse d’arrivée" onChange={(e) => patchExp(i, (x) => ({ ...x, to: { kind: 'autre', address: e.target.value } }))} />}
                        <label className="field">Adresse du commerce (facultatif — sinon j’utilise ta position)<input value={m.exp.shopAddress} placeholder="ex.: 1200 boul. Laurier, Beloeil" onChange={(e) => patchExp(i, (x) => ({ ...x, shopAddress: e.target.value }))} /></label>
                        <button type="button" className="btn small accent" disabled={busy} onClick={() => void confirmExp(i)}>Enregistrer le reçu</button>
                      </>
                    )}
                    {m.exp.saved && (
                      <>
                        <div className="small"><span className="badge green">Fait</span> {m.exp.saved.summary}</div>
                        <div className="row" style={{ gap: 6 }}>
                          <Link className="btn small" to={'/depenses/' + m.exp.saved.expenseId} onClick={() => setOpen(false)}>Voir le reçu</Link>
                          <Link className="btn small" to="/km" onClick={() => setOpen(false)}>Journal de bord</Link>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {m.doc && (
                  <div className="lea-card lea-doc">
                    <div className="lea-doc-h"><b>{DOC_LABEL[m.doc.ai.type]}</b>{m.doc.created && <span>{m.doc.name}</span>}</div>
                    {!m.doc.created && (
                      <>
                        <ClientPicker value={m.doc.clientId ?? 0} onChange={(id) => { const c = clientsRef.current.find((x) => x.id === id); patchDoc(i, (x) => ({ ...x, clientId: id, name: c?.name ?? x.name, address: x.address || c?.address || '', phone: x.phone || c?.phone || '' })); }} />
                        {!m.doc.clientId && m.doc.name && <div className="small muted">« {m.doc.name} » n’est pas dans tes clients: choisis-le plus haut, ou je le crée comme nouveau client.</div>}
                        {(m.doc.ai.type !== 'facture' && (m.doc.ai.type !== 'soumission' || m.doc.hasDate)) && (
                          <div className="lea-doc-row">
                            <label className="field">Date<input type="date" value={m.doc.date} onChange={(e) => patchDoc(i, (x) => ({ ...x, date: e.target.value, hasDate: true }))} /></label>
                            <label className="field">Heure<input type="time" value={m.doc.time} onChange={(e) => patchDoc(i, (x) => ({ ...x, time: e.target.value }))} /></label>
                          </div>
                        )}
                        {(m.doc.ai.type === 'soumission' || m.doc.ai.type === 'job') && <label className="check"><input type="checkbox" checked={m.doc.detailed} onChange={(e) => patchDoc(i, (x) => ({ ...x, detailed: e.target.checked }))} /> Devis détaillé (texte complet des travaux et conditions)</label>}
                        {m.doc.ai.type !== 'visite' && <TaxMode doc={m.doc.tax} onChange={(t) => patchDoc(i, (x) => ({ ...x, tax: { applyTps: t.applyTps, applyTvq: t.applyTvq, taxIncluded: !!t.taxIncluded } }))} />}
                        {m.doc.ai.type === 'soumission' && !m.doc.hasDate && <button type="button" className="btn small" onClick={() => patchDoc(i, (x) => ({ ...x, hasDate: true }))}>+ Planifier la job aussi</button>}
                        <label className="field">Adresse<input value={m.doc.address} onChange={(e) => patchDoc(i, (x) => ({ ...x, address: e.target.value }))} /></label>
                        {m.doc.ai.type !== 'visite' && m.doc.items.map((it, k) => (
                          <div key={k} className="lea-doc-line">
                            <input className="ld-desc" value={it.description} aria-label="Travaux" onChange={(e) => patchDoc(i, (x) => ({ ...x, items: x.items.map((y, n) => (n === k ? { ...y, description: e.target.value } : y)) }))} />
                            <input className="ld-qty" type="number" inputMode="decimal" value={it.quantity} aria-label="Quantité" onChange={(e) => patchDoc(i, (x) => ({ ...x, items: x.items.map((y, n) => (n === k ? { ...y, quantity: Number(e.target.value) } : y)) }))} />
                            <input className="ld-price" type="number" inputMode="decimal" value={it.unitPrice || ''} placeholder="Prix $" aria-label="Prix" onChange={(e) => patchDoc(i, (x) => ({ ...x, items: x.items.map((y, n) => (n === k ? { ...y, unitPrice: Number(e.target.value) } : y)) }))} />
                          </div>
                        ))}
                        {m.doc.ai.type !== 'visite' && <button type="button" className="btn small" onClick={() => patchDoc(i, (x) => ({ ...x, items: [...x.items, { code: '', description: '', quantity: 1, unitPrice: 0 }] }))}>+ Ajouter une ligne</button>}
                        {m.doc.ai.type !== 'visite' && m.doc.items.some((it) => it.unitPrice) && <div className="lea-doc-total">Total avec taxes: <b>{money(docTotals({ items: m.doc.items, applyTps: s.chargeTaxes, applyTvq: s.chargeTaxes, payments: [] }, s).total)}</b></div>}
                        <button type="button" className="btn small accent" disabled={busy} onClick={() => void confirmDoc(i)}>{m.doc.ai.type === 'facture' ? 'Créer la facture' : m.doc.ai.type === 'soumission' ? (m.doc.hasDate ? 'Créer la soumission et planifier' : 'Créer la soumission') : m.doc.ai.type === 'visite' ? 'Planifier la visite' : 'Planifier la job'}</button>
                      </>
                    )}
                    {m.doc.created && (
                      <>
                        <div className="small"><span className="badge green">Fait</span> {m.doc.created.summary}</div>
                        <div className="row" style={{ gap: 6 }}>
                          {m.doc.created.invoiceId && <Link className="btn small accent" to={'/doc/' + m.doc.created.invoiceId} onClick={() => setOpen(false)}>Ouvrir la facture</Link>}
                          {m.doc.created.quoteId && <Link className="btn small accent" to={'/doc/' + m.doc.created.quoteId} onClick={() => setOpen(false)}>Ouvrir la soumission</Link>}
                          {m.doc.created.jobId && <Link className="btn small" to={'/job/' + m.doc.created.jobId} onClick={() => setOpen(false)}>Voir la job</Link>}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {m.handoff && (
                  <div className="lea-card">
                    <button className="btn small accent" onClick={() => { setOpen(false); nav('/dicter', { state: { leaAsk: m.handoff!.ask, leaResult: m.handoff!.result } }); }}>Voir et confirmer</button>
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="lea-msg lea-typing" aria-label="Léa écrit"><i /><i /><i /></div>}
            <div ref={endRef} />
          </div>
          {on ? (
            <>
            {photo && <div className="lea-photo"><img src={photo.url} alt="" /><button className="icon-btn" aria-label="Retirer la photo" onClick={() => setPhoto(null)}><X size={14} /></button></div>}
            {call !== 'off' && (
              <div className="lea-call"><span className={`lea-wave ${phase === 'listen' ? '' : 'calm'}`}><i /><i /><i /><i /></span><span className="lea-call-txt">{phase === 'listen' ? (heard || 'Je t’écoute… parle quand tu veux.') : phase === 'think' ? 'Je réfléchis…' : 'Léa parle…'}</span><button type="button" className="btn small danger" onClick={hangUp}>Raccrocher</button></div>
            )}
            {!msgs.length && !busy && call === 'off' && (
              <div className="lea-chips">
                {QUICK.map((q) => <button key={q.label} type="button" className="chip-btn" onClick={() => void send(q.ask)}>{q.label}</button>)}
              </div>
            )}
            <form className="lea-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <label className="icon-btn" aria-label="Joindre une photo" title="Photo (reçu, demande…)"><Camera size={18} /><input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickPhoto(f); }} /></label>
              <input value={input} placeholder="Demande-moi n’importe quoi…" onChange={(e) => setInput(e.target.value)} aria-label="Message pour Léa" />
              <button type="button" className={`icon-btn lea-mic ${call !== 'off' ? 'on' : ''}`} aria-label={call === 'off' ? 'Parler à Léa à voix haute' : 'Raccrocher'} onClick={() => void toggleCall()}>{call === 'off' ? <Mic size={18} /> : <PhoneOff size={18} />}</button>
              <button type="submit" className="btn small accent" disabled={busy || (!input.trim() && !photo)} aria-label="Envoyer"><Send size={16} /></button>
            </form>
            </>
          ) : (
            <div className="lea-input small muted">Pour discuter avec moi, active l’assistant IA dans Paramètres.</div>
          )}
        </section>
      )}
      {relanceDoc && <RelanceModal doc={relanceDoc} client={clients.find((c) => c.id === relanceDoc.clientId)} onClose={() => setRelanceDoc(null)} />}
      {relance?.doc && <RelanceModal doc={relance.doc} client={relance.client} onClose={() => setRelance(null)} />}
    </>
  );
}
