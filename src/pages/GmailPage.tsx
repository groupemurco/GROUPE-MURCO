import { Sparkles } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errMsg, useToast } from '../components/Toast';
import { db } from '../lib/db';
import { connectGmail, disconnectGmail, getAttachment, getMailText, gmailThreadLink, isGmailConnected, searchMail, type MailSummary } from '../lib/gmail';
import { DEVIS_MAIL_KEY } from '../components/DevisEditor';
import { useSettings } from '../lib/hooks';
import { pendingImport } from '../lib/receipt';
import { toISODate } from '../lib/utils';

const PRESETS = [
  { label: 'Boîte de réception', q: 'in:inbox' },
  { label: 'Reçus / factures fournisseurs', q: 'has:attachment (facture OR reçu OR receipt OR invoice OR "bon de commande") newer_than:90d' },
  { label: 'Mes clients', q: '__clients__' },
  { label: 'Envoyés', q: 'in:sent' },
];

function emailOf(from: string) {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}
function nameOf(from: string) {
  const m = from.match(/^"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : from;
}

export default function GmailPage() {
  const s = useSettings();
  const notify = useToast();
  const nav = useNavigate();
  const [connected, setConnected] = useState(isGmailConnected());
  const [q, setQ] = useState('in:inbox');
  const [mails, setMails] = useState<MailSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const clients = useLiveQuery(() => db.clients.toArray(), []) ?? [];
  const sent = useLiveQuery(() => db.emails.orderBy('date').reverse().limit(15).toArray(), []) ?? [];
  const byEmail = new Map(clients.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]));

  const connect = async () => {
    try {
      await connectGmail(s.googleClientId);
      setConnected(true);
      notify('Gmail connecté');
      run('in:inbox');
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };

  const run = async (query = q) => {
    let real = query;
    if (query === '__clients__') {
      const emails = clients.map((c) => c.email).filter(Boolean);
      if (!emails.length) return notify('Aucun client avec courriel.', 'err');
      real = emails.slice(0, 40).map((e) => `from:${e}`).join(' OR ');
    }
    setQ(query === '__clients__' ? q : query);
    setLoading(true);
    try {
      setMails(await searchMail(real, 25));
    } catch (e) {
      notify(errMsg(e), 'err');
      setConnected(isGmailConnected());
    } finally {
      setLoading(false);
    }
  };

  const importAttachment = async (m: MailSummary, a: MailSummary['attachments'][number]) => {
    try {
      const blob = await getAttachment(m.id, a.attachmentId, a.mimeType);
      pendingImport.file = new File([blob], a.filename, { type: a.mimeType });
      pendingImport.vendor = nameOf(m.from);
      pendingImport.date = toISODate(new Date(m.date));
      nav('/depenses/new');
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };

  /** Le courriel du client → « Soumission IA »: client, soumission et prix en un clic. */
  const makeDevis = async (m: MailSummary) => {
    try {
      sessionStorage.setItem(DEVIS_MAIL_KEY, await getMailText(m.id));
      nav('/soumission-ia');
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };

  const addClient = async (m: MailSummary) => {
    const id = await db.clients.add({ name: nameOf(m.from), contact: nameOf(m.from), email: emailOf(m.from), phone: '', address: '', notes: '', createdAt: new Date().toISOString() });
    notify('Client ajouté');
    nav(`/clients/${id}`);
  };

  return (
    <>
      <div className="page-head">
        <h1>Gmail</h1>
        {connected ? (
          <button className="btn" onClick={() => { disconnectGmail(); setConnected(false); setMails(null); }}>Déconnecter</button>
        ) : (
          <button className="btn accent" onClick={connect} disabled={!s.googleClientId}>Connecter Gmail</button>
        )}
      </div>

      {!s.googleClientId && (
        <div className="notice">
          Pour relier ta boîte Gmail, il faut un « ID client OAuth » Google (gratuit, 10 minutes, une seule fois). Les étapes sont dans{' '}
          <Link to="/parametres">Paramètres → Gmail</Link>. En attendant, les boutons « Envoyer » ouvrent ta messagerie avec le PDF prêt à joindre.
        </div>
      )}

      {connected && (
        <div className="card">
          <div className="tabs">
            {PRESETS.map((p) => <button key={p.label} onClick={() => run(p.q)}>{p.label}</button>)}
          </div>
          <form className="row" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); run(); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Recherche Gmail (ex.: from:client@exemple.com)" />
            <button className="btn primary" disabled={loading}>{loading ? '…' : 'Chercher'}</button>
          </form>
          <div style={{ marginTop: 10 }}>
            {mails?.length === 0 && <div className="empty">Aucun message.</div>}
            {mails?.map((m) => {
              const client = byEmail.get(emailOf(m.from));
              return (
                <div key={m.id} className="mail-item">
                  <div className="row">
                    <a href={gmailThreadLink(m.threadId)} target="_blank" rel="noreferrer"><strong>{m.subject || '(sans objet)'}</strong></a>
                    <div className="spacer" />
                    <span className="small muted">{new Date(m.date).toLocaleDateString('fr-CA')}</span>
                  </div>
                  <div className="small muted">
                    {m.from}{' '}
                    {client ? <Link to={`/clients/${client.id}`} className="badge green">client: {client.name}</Link> : <button className="btn small" onClick={() => addClient(m)}>+ client</button>}
                  </div>
                  <div className="small">{m.snippet}</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="btn small accent" onClick={() => void makeDevis(m)}><Sparkles size={14} /> Faire un devis</button>
                  </div>
                  {m.attachments.length > 0 && (
                    <div className="row" style={{ marginTop: 6 }}>
                      {m.attachments.map((a) => (
                        <button key={a.attachmentId} className="btn small" onClick={() => importAttachment(m, a)} disabled={!/^(image\/|application\/pdf)/.test(a.mimeType)}>
                          {a.filename} → reçu
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Envoyés depuis l’application</h2>
        {sent.length === 0 ? <div className="empty">Aucun envoi pour l’instant.</div> : (
          <table className="list"><tbody>
            {sent.map((e) => (
              <tr key={e.id} className={e.docId ? 'click' : ''} onClick={() => e.docId && nav(`/doc/${e.docId}`)}>
                <td>{new Date(e.date).toLocaleString('fr-CA')}</td><td>{e.subject}<div className="small muted">→ {e.to}</div></td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}
