import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Mic, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { jobToInvoice, smsLink } from '../lib/agenda';
import { AiAssistant, aiConfigured, aiErrorMessage, type AiClientEdit, type AiMessage, type AiResult } from '../lib/ai';
import { propose, type Proposal, type Step } from '../lib/assistantActions';
import { db, type Client, type Doc } from '../lib/db';
import { useSettings } from '../lib/hooks';
import { buildTodos, snoozeTodo, type Todo } from '../lib/todo';
import { todayISO } from '../lib/utils';
import leaPhoto from '../assets/lea.png';
import { RelanceModal } from './RelanceModal';
import { errMsg, useToast } from './Toast';

/** Léa, l'agente administrative: sa photo ne change pas. */
export function LeaAvatar({ size = 48 }: { size?: number }) {
  return <img className="lea-av" src={leaPhoto} width={size} height={size} alt="Léa" />;
}

type Msg = { me?: boolean; text: string; message?: AiMessage & { name: string; phone: string; email: string; subject: string }; edit?: { client: Client; edit: AiClientEdit; done?: boolean }; handoff?: { ask: string; result: AiResult }; prop?: Proposal };

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
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const send = async (override?: string) => {
    const text = (override ?? input).trim() || (photo ? 'Voici une photo. Qu’est-ce que je dois en faire?' : '');
    if (!text || busy) return;
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
      if (r.kind === 'say') setMsgs((m) => [...m, { text: r.text }]);
      else if (r.kind === 'message') {
        const c = clientsRef.current.find((x) => x.id === r.message.clientId);
        if (!c) setMsgs((m) => [...m, { text: 'Je ne trouve pas ce client. Redis-moi son nom.' }]);
        else setMsgs((m) => [...m, { text: r.text || `Voici le message pour ${c.name}. Change ce que tu veux, puis envoie-le.`, message: { ...r.message, name: c.name, phone: c.phone, email: c.email, subject: r.message.subject ?? `Message de ${s.companyName}` } }]);
      } else if (r.kind === 'client') {
        const c = clientsRef.current.find((x) => x.id === r.edit.clientId);
        if (!c) setMsgs((m) => [...m, { text: 'Je ne trouve pas ce client. Redis-moi son nom.' }]);
        else setMsgs((m) => [...m, { text: r.text || `Je change la fiche de ${c.name}. Confirme.`, edit: { client: c, edit: r.edit } }]);
      } else if (r.kind === 'intent') {
        const p = await propose(r.intent);
        setMsgs((m) => [...m, { text: p.say || r.text, prop: p }]);
      } else {
        setMsgs((m) => [...m, { text: r.text || 'C’est prêt. Je te l’ouvre pour que tu confirmes.', handoff: { ask: text, result: r } }]);
      }
    } catch (e) {
      setMsgs((m) => [...m, { text: aiErrorMessage(e).replace(' J’utilise l’assistant de base.', '') }]);
      ai.current = null;
    } finally {
      setBusy(false);
    }
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
            <button className="icon-btn" aria-label="Fermer" onClick={() => setOpen(false)}><X size={18} /></button>
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
            {!msgs.length && !busy && (
              <div className="lea-chips">
                {QUICK.map((q) => <button key={q.label} type="button" className="chip-btn" onClick={() => void send(q.ask)}>{q.label}</button>)}
              </div>
            )}
            <form className="lea-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <label className="icon-btn" aria-label="Joindre une photo" title="Photo (reçu, demande…)"><Camera size={18} /><input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickPhoto(f); }} /></label>
              <input value={input} placeholder="Demande-moi n’importe quoi…" onChange={(e) => setInput(e.target.value)} aria-label="Message pour Léa" />
              <button type="button" className="icon-btn" aria-label="Parler à voix haute" onClick={() => { setOpen(false); nav('/dicter'); }}><Mic size={18} /></button>
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
