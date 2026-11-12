import { EventList } from '../components/Cockpit';
import { buildActivity } from '../lib/cockpit';
import { anonymizeClient, exportClientData } from '../lib/privacy';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ClientFormModal } from '../components/ClientForm';
import { PreviewButton } from '../components/DocPreview';
import { SendEmailModal } from '../components/SendEmailModal';
import { errMsg, useConfirm, useToast } from '../components/Toast';
import { db } from '../lib/db';
import { JOB_STATUS_LABEL } from '../lib/agenda';
import { MediaGallery } from '../components/MediaGallery';
import { ClientThread } from '../components/ClientThread';
import { AdminNote } from '../components/AdminNote';
import { mapsLink } from '../lib/geo';
import { gmailThreadLink, isGmailConnected, searchMail, type MailSummary } from '../lib/gmail';
import { useSettings } from '../lib/hooks';
import { docTotals, km, money, statusClass, statusLabel, downloadBlob, todayISO } from '../lib/utils';

export default function ClientDetail() {
  const { id } = useParams();
  const cid = Number(id);
  const nav = useNavigate();
  const s = useSettings();
  const notify = useToast();
  const ask = useConfirm();
  const [editing, setEditing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [mails, setMails] = useState<MailSummary[] | null>(null);
  const [loadingMail, setLoadingMail] = useState(false);

  const data = useLiveQuery(async () => {
    const client = await db.clients.get(cid);
    const jobs = await db.jobs.where('clientId').equals(cid).toArray();
    const [docs, trips, expenses, emails] = await Promise.all([
      db.docs.where('clientId').equals(cid).toArray(),
      db.trips.where('clientId').equals(cid).toArray(),
      db.expenses.where('clientId').equals(cid).toArray(),
      db.emails.where('clientId').equals(cid).toArray(),
    ]);
    return { client, docs: docs.sort((a, b) => b.date.localeCompare(a.date)), trips, expenses, emails, jobs: jobs.sort((a, b) => b.date.localeCompare(a.date)) };
  }, [cid]);
  if (!data) return null;
  if (!data.client) return <div className="empty">Client introuvable. <Link to="/clients">Retour</Link></div>;
  const c = data.client;

  const loadMail = async () => {
    if (!c.email) return notify('Ce client n’a pas de courriel.', 'err');
    setLoadingMail(true);
    try {
      setMails(await searchMail(`from:${c.email} OR to:${c.email}`, 20));
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setLoadingMail(false);
    }
  };

  const invoices = data.docs.filter((d) => d.type === 'invoice' && d.status !== 'draft' && d.status !== 'cancelled');
  const billed = invoices.reduce((a, d) => a + docTotals(d, s).total, 0);
  const due = invoices.filter((d) => d.status !== 'paid').reduce((a, d) => a + docTotals(d, s).balance, 0);
  const kms = data.trips.reduce((a, t) => a + t.totalKm, 0);

  const remove = async () => {
    if (data.docs.length) return notify('Ce client a des factures/soumissions: supprime-les d’abord.', 'err');
    if (!(await ask({ title: `Supprimer ${c.name}?`, confirm: 'Supprimer', danger: true }))) return;
    await db.clients.delete(cid);
    nav('/clients');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted"><Link to="/clients">← Clients</Link></div>
          <h1>{c.name}</h1>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => nav(`/job/new?client=${cid}`)}>Planifier un job</button>
          <button className="btn accent" onClick={() => nav(`/doc/new?type=invoice&client=${cid}`)}>+ Facture</button>
          <button className="btn primary" onClick={() => nav(`/doc/new?type=quote&client=${cid}`)}>+ Soumission</button>
          <button className="btn" onClick={() => setWriting(true)} disabled={!c.email}>Écrire</button>
          <button className="btn" onClick={() => setEditing(true)}>Modifier</button>
        </div>
      </div>

      <div className="grid kpi">
        <div className="card"><div className="label">Total facturé</div><div className="value">{money(billed)}</div></div>
        <div className="card"><div className="label">À recevoir</div><div className="value">{money(due)}</div></div>
        <div className="card"><div className="label">Km pour ce client</div><div className="value">{km(kms)}</div></div>
        <div className="card"><div className="label">Dépenses liées</div><div className="value">{money(data.expenses.reduce((a, e) => a + e.total, 0))}</div></div>
      </div>

      {(() => {
        const events = buildActivity(data.docs, data.jobs, [], new Map([[cid, c]]), todayISO(), 12);
        return events.length > 0 ? (
          <div className="card ck-feed">
            <div className="ck-head"><h2>Historique avec ce client</h2></div>
            <EventList events={events} today={todayISO()} seenAt="9999" />
          </div>
        ) : null;
      })()}

      <ClientThread client={c} />

      <div className="grid two">
        <div className="card">
          <h2>Coordonnées</h2>
          {c.contact && <div>{c.contact}</div>}
          {c.phone && <div><a href={`tel:${c.phone}`}>{c.phone}</a></div>}
          {c.email && <div><a href={`mailto:${c.email}`}>{c.email}</a></div>}
          {c.address && <div><a href={mapsLink(c.geo, c.address)} target="_blank" rel="noreferrer">{c.address}</a></div>}
          <label className="field full" style={{ marginTop: 10 }}>Notes internes <span className="small muted">— visibles par l’équipe</span>
            <textarea rows={2} defaultValue={c.notes} placeholder="Code de porte, chien, préférences…" onBlur={(e) => e.target.value !== c.notes && void db.clients.update(cid, { notes: e.target.value })} />
          </label>
          <AdminNote refKey={`client:${cid}`} />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn small" onClick={async () => downloadBlob(await exportClientData(cid), `client_${c.name.replace(/[^\w-]+/g, '_')}_${todayISO()}.json`)} title="Demande d’accès d’un client (Loi 25)">Exporter ses données</button>
            {data.docs.length ? (
              <button className="btn small danger" onClick={async () => {
                if (!(await ask({ title: `Anonymiser ${c.name}?`, message: 'À la demande du client (Loi 25): son nom, ses coordonnées, ses adresses, ses photos et ses demandes sont effacés. Les montants de ses factures restent pour ta comptabilité (registres à garder 6 ans). Irréversible.', confirm: 'Anonymiser', danger: true }))) return;
                await anonymizeClient(cid);
                notify('Client anonymisé');
              }}>Supprimer ses renseignements</button>
            ) : (
              <button className="btn small danger" onClick={remove}>Supprimer le client</button>
            )}
          </div>
        </div>
        <div className="card">
          <div className="row"><h2 style={{ margin: 0 }}>Courriels Gmail</h2><div className="spacer" />
            <button className="btn small" onClick={loadMail} disabled={loadingMail || !isGmailConnected()}>{loadingMail ? '…' : '↻ Charger'}</button>
          </div>
          {!isGmailConnected() && <div className="small muted" style={{ marginTop: 8 }}>Connecte Gmail (page Gmail) pour voir les échanges avec ce client.</div>}
          {mails?.length === 0 && <div className="small muted">Aucun courriel trouvé.</div>}
          {mails?.map((m) => (
            <div key={m.id} className="mail-item">
              <a href={gmailThreadLink(m.threadId)} target="_blank" rel="noreferrer"><strong>{m.subject || '(sans objet)'}</strong></a>
              <div className="small muted">{new Date(m.date).toLocaleString('fr-CA')} · {m.from}</div>
              <div className="small">{m.snippet}</div>
            </div>
          ))}
          {data.emails.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <h3>Envoyés depuis l’app</h3>
              {data.emails.map((e) => <div key={e.id} className="small">{new Date(e.date).toLocaleDateString('fr-CA')} — {e.subject}</div>)}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Factures et soumissions</h2>
        {data.docs.length === 0 ? <div className="empty">Rien pour l’instant.</div> : (
          <table className="list">
            <tbody>
              {data.docs.map((d) => (
                <tr key={d.id} className="click" onClick={() => nav(`/doc/${d.id}`)}>
                  <td>{d.type === 'invoice' ? '' : ''} <strong>{d.number}</strong><div className="small muted">{d.title}</div></td>
                  <td className="hide-mobile">{d.date}</td>
                  <td><span className={statusClass(d)}>{statusLabel(d)}</span></td>
                  <td className="num">{money(docTotals(d, s).total)}</td>
                  <td style={{ width: 1 }}><PreviewButton doc={d} client={data.client} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.jobs.length > 0 && (
        <div className="card">
          <h2>Jobs</h2>
          <table className="list"><tbody>
            {data.jobs.map((j) => (
              <tr key={j.id} className="click" onClick={() => nav(`/job/${j.id}`)}>
                <td>{j.date}{j.time ? ` · ${j.time}` : ''}</td><td>{j.title}</td><td><span className={`badge ${j.status === 'planifie' ? 'blue' : j.status === 'fait' ? 'green' : 'gray'}`}>{JOB_STATUS_LABEL[j.status]}</span></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      <MediaGallery link={{ clientId: cid }} addKinds={['avant', 'apres', 'job']} title="Photos du client" />

      {data.trips.length > 0 && (
        <div className="card">
          <h2>Déplacements</h2>
          <table className="list"><tbody>
            {data.trips.sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
              <tr key={t.id}><td>{t.date}</td><td>{t.reason}</td><td className="num">{km(t.totalKm)}</td></tr>
            ))}
          </tbody></table>
        </div>
      )}

      {editing && <ClientFormModal initial={c} onClose={() => setEditing(false)} />}
      {writing && (
        <SendEmailModal
          to={c.email}
          subject={`${s.companyName}`}
          body={`Bonjour ${c.contact || c.name},\n\n\n\n${s.emailSignature || s.companyName}\n${s.phone}`}
          attachments={[]}
          onClose={() => setWriting(false)}
          onSent={async ({ gmailId, to, subject }) => { await db.emails.add({ date: new Date().toISOString(), to, subject, clientId: cid, gmailId, kind: 'autre' }); }}
        />
      )}
    </>
  );
}
