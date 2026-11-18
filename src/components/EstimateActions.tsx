import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardCheck, FileText, Link2, Unlink } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { quoteToInvoice } from '../lib/assistantActions';
import { db, type Client, type Doc, type Job } from '../lib/db';
import { useSettings } from '../lib/hooks';
import { pendingEstimate, quoteOfEstimate } from '../lib/estimates';
import { docTotals, formatDate, money } from '../lib/utils';
import { EstimateFollowUp } from './EstimateFollowUp';
import { errMsg, useToast } from './Toast';

/** Sur une estimation faite: sa soumission, et un seul geste pour facturer quand le client a accepté. */
export function EstimateActions({ job, client }: { job: Job; client?: Client }) {
  const nav = useNavigate();
  const s = useSettings();
  const notify = useToast();
  const [follow, setFollow] = useState(false);
  const [busy, setBusy] = useState(false);
  const quote = useLiveQuery(() => quoteOfEstimate(job), [job.id, job.clientId, job.docId]);
  const invoice = useLiveQuery(async () => (quote?.convertedInvoiceId ? db.docs.get(quote.convertedInvoiceId) : undefined), [quote?.convertedInvoiceId]);
  if (job.type !== 'estimation' || job.status === 'planifie' || job.status === 'annule') return null;

  const accepted = !!quote && (quote.status === 'accepted' || !!quote.signature);
  const bill = async () => {
    if (!quote) return;
    setBusy(true);
    try {
      nav(`/doc/${await quoteToInvoice(quote)}`);
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="est-actions">
      <span className="est-tag"><ClipboardCheck size={14} /> Estimation faite le {formatDate(job.date)}</span>
      {!quote && <button type="button" className="btn small accent" onClick={() => setFollow(true)}><FileText size={14} /> Faire la soumission</button>}
      {quote && (
        <>
          <Link className="btn small" to={`/doc/${quote.id}`}><FileText size={14} /> {quote.number} · {money(docTotals(quote, s).total)} · {quote.signature ? 'signée' : quote.status === 'accepted' ? 'acceptée' : quote.viewedAt ? 'ouverte' : quote.status === 'sent' ? 'envoyée' : 'brouillon'}</Link>
          {invoice ? <Link className="btn small" to={`/doc/${invoice.id}`}>Facture {invoice.number}</Link> : accepted && <button type="button" className="btn small accent" disabled={busy} onClick={() => void bill()}>Facturer</button>}
        </>
      )}
      {follow && <EstimateFollowUp job={job} client={client} onClose={() => setFollow(false)} />}
    </div>
  );
}

/** Dans une soumission: l'estimation à laquelle elle est reliée, ou l'estimation faite chez ce client qu'on peut relier. */
export function EstimateLinkNotice({ doc }: { doc: Doc }) {
  const notify = useToast();
  const linked = useLiveQuery(async () => (doc.estimateJobId ? db.jobs.get(doc.estimateJobId) : undefined), [doc.estimateJobId]);
  const pending = useLiveQuery(async () => (doc.id && doc.type === 'quote' && !doc.estimateJobId && doc.clientId ? pendingEstimate(doc.clientId) : undefined), [doc.id, doc.type, doc.estimateJobId, doc.clientId]);
  if (doc.type !== 'quote' || !doc.id) return null;
  const set = async (jobId?: number) => {
    try {
      await db.docs.update(doc.id!, { estimateJobId: jobId });
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };
  if (linked) {
    return (
      <div className="notice info est-link">
        <span><Link2 size={14} /> Reliée à l’estimation faite le {formatDate(linked.date)}{linked.address ? ` (${linked.address})` : ''}. <Link to={`/job/${linked.id}`}>Voir la visite</Link></span>
        <button type="button" className="btn small" onClick={() => void set(undefined)}><Unlink size={13} /> Détacher</button>
      </div>
    );
  }
  if (pending) {
    return (
      <div className="notice est-link">
        <span><ClipboardCheck size={14} /> Tu as fait une estimation chez ce client le {formatDate(pending.date)}. C’est pour cette soumission?</span>
        <button type="button" className="btn small accent" onClick={() => void set(pending.id)}>Oui, relier</button>
      </div>
    );
  }
  return null;
}
