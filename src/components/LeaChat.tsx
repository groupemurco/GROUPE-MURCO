import { useLiveQuery } from 'dexie-react-hooks';
import { Mic, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { jobToInvoice, smsLink } from '../lib/agenda';
import { AiAssistant, aiConfigured, aiErrorMessage, type AiClientEdit, type AiMessage, type AiResult } from '../lib/ai';
import { db, type Client } from '../lib/db';
import { useSettings } from '../lib/hooks';
import { buildTodos, snoozeTodo, type Todo } from '../lib/todo';
import { todayISO } from '../lib/utils';
import { RelanceModal } from './RelanceModal';
import { errMsg, useToast } from './Toast';

/** Léa, l'agente administrative: son visage ne change pas. */
export function LeaAvatar({ size = 48 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Léa" style={{ borderRadius: '50%', flex: 'none' }}>
      <defs><clipPath id="lea-clip"><circle cx="32" cy="32" r="32" /></clipPath></defs>
      <g clipPath="url(#lea-clip)">
        <rect width="64" height="64" fill="#f2c27a" />
        <path d="M6 64c2-14 12-20 26-20s24 6 26 20z" fill="#2f3a4f" />
        <path d="M25 44l7 11 7-11z" fill="#fff" />
        <rect x="28" y="36" width="8" height="10" rx="3" fill="#e8b48f" />
        <path d="M14 36c-2-17 8-26 18-26s20 9 18 26c-1 8-4 12-6 14H20c-2-2-5-6-6-14z" fill="#5a3a26" />
        <ellipse cx="32" cy="30" rx="11" ry="13" fill="#f3c9a5" />
        <path d="M20 28c2-9 8-12 13-12 6 0 10 5 11 12-4-4-9-6-14-6s-8 2-10 6z" fill="#5a3a26" />
        <circle cx="27.5" cy="31" r="1.3" fill="#2b2b2b" />
        <circle cx="36.5" cy="31" r="1.3" fill="#2b2b2b" />
        <path d="M28 37c2.5 2.5 5.5 2.5 8 0" stroke="#b5524a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M18 30c0-9 6-15 14-15s14 6 14 15" stroke="#222" strokeWidth="1.6" fill="none" />
        <rect x="16" y="29" width="4" height="8" rx="2" fill="#222" />
        <path d="M19 36c0 5 4 7 9 7" stroke="#222" strokeWidth="1.4" fill="none" />
        <circle cx="29" cy="43" r="1.6" fill="#222" />
      </g>
    </svg>
  );
}

type Msg = { me?: boolean; text: string; message?: AiMessage & { name: string; phone: string; email: string; subject: string }; edit?: { client: Client; edit: AiClientEdit; done?: boolean }; handoff?: { ask: string; result: AiResult } };

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
  const on = aiConfigured(s.aiAssistant);
  const first = (s.ownerName || '').split(' ')[0];

  // Léa lance la conversation à l'ouverture de l'app (une fois par session)
  useEffect(() => {
    if (!todos?.length) return;
    try {
      if (sessionStorage.getItem('lea-teaser')) return;
      sessionStorage.setItem('lea-teaser', '1');
    } catch { /* tant pis */ }
    setTeaser(true);
  }, [todos]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, open, busy]);
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMsgs((m) => [...m, { me: true, text }]);
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
      const r = await ai.current.send(text);
      if (r.kind === 'say') setMsgs((m) => [...m, { text: r.text }]);
      else if (r.kind === 'message') {
        const c = clientsRef.current.find((x) => x.id === r.message.clientId);
        if (!c) setMsgs((m) => [...m, { text: 'Je ne trouve pas ce client. Redis-moi son nom.' }]);
        else setMsgs((m) => [...m, { text: r.text || `Voici le message pour ${c.name}. Change ce que tu veux, puis envoie-le.`, message: { ...r.message, name: c.name, phone: c.phone, email: c.email, subject: r.message.subject ?? `Message de ${s.companyName}` } }]);
      } else if (r.kind === 'client') {
        const c = clientsRef.current.find((x) => x.id === r.edit.clientId);
        if (!c) setMsgs((m) => [...m, { text: 'Je ne trouve pas ce client. Redis-moi son nom.' }]);
        else setMsgs((m) => [...m, { text: r.text || `Je change la fiche de ${c.name}. Confirme.`, edit: { client: c, edit: r.edit } }]);
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
      {!open && teaser && count > 0 && (
        <div className="lea-teaser">
          <button className="lea-teaser-x" aria-label="Fermer" onClick={() => setTeaser(false)}><X size={13} /></button>
          <button className="lea-teaser-txt" onClick={() => { setTeaser(false); setOpen(true); }}>{greet.replace(' à te signaler au bureau:', ' à régler. Je te montre?')}</button>
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
                {m.handoff && (
                  <div className="lea-card">
                    <button className="btn small accent" onClick={() => { setOpen(false); nav('/dicter', { state: { leaAsk: m.handoff!.ask, leaResult: m.handoff!.result } }); }}>Voir et confirmer</button>
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="lea-msg">…</div>}
            <div ref={endRef} />
          </div>
          {on ? (
            <form className="lea-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <input value={input} placeholder="Demande-moi n’importe quoi…" onChange={(e) => setInput(e.target.value)} aria-label="Message pour Léa" />
              <button type="button" className="icon-btn" aria-label="Parler à voix haute" onClick={() => { setOpen(false); nav('/dicter'); }}><Mic size={18} /></button>
              <button type="submit" className="btn small accent" disabled={busy || !input.trim()} aria-label="Envoyer"><Send size={16} /></button>
            </form>
          ) : (
            <div className="lea-input small muted">Pour discuter avec moi, active l’assistant IA dans Paramètres.</div>
          )}
        </section>
      )}
      {relance?.doc && <RelanceModal doc={relance.doc} client={relance.client} onClose={() => setRelance(null)} />}
    </>
  );
}
