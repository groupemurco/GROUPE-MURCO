import { useLiveQuery } from 'dexie-react-hooks';
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { blankJob } from '../lib/agenda';
import { createFromAi, type AiCreated } from '../lib/aiCreate';
import { db, type Client, type Job } from '../lib/db';
import { useSettings } from '../lib/hooks';
import { docTotals, formatDate, money, todayISO } from '../lib/utils';
import { Modal } from './Modal';
import { NumInput } from './NumInput';
import { TaxMode } from './TaxMode';
import { errMsg, useToast } from './Toast';

/**
 * Après une estimation faite: c'est combien, quels travaux, as-tu une journée pour les faire?
 * Crée la soumission (en lignes ou en devis détaillé) et planifie la job des travaux, ou reprend une soumission déjà faite.
 */
export function EstimateFollowUp({ job, client, onClose }: { job: Job; client?: Client; onClose: () => void }) {
  const nav = useNavigate();
  const s = useSettings();
  const notify = useToast();
  const quotes = useLiveQuery(async () => (await db.docs.where('clientId').equals(job.clientId).toArray()).filter((d) => d.type === 'quote' && d.status !== 'refused' && d.status !== 'cancelled' && !d.jobId).sort((a, b) => b.date.localeCompare(a.date)), [job.clientId]) ?? [];
  const [quoteId, setQuoteId] = useState(0);
  const [price, setPrice] = useState(0);
  const [what, setWhat] = useState(job.title || '');
  const [detailed, setDetailed] = useState(true);
  const [tax, setTax] = useState({ applyTps: !!s.chargeTaxes, applyTvq: !!s.chargeTaxes, taxIncluded: false });
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AiCreated | null>(null);

  const address = job.address || client?.address || '';
  const existing = quotes.find((q) => q.id === quoteId);

  const save = async () => {
    if (!existing && !(price > 0)) return notify('C’est combien, l’estimation? Entre le prix (ou choisis une soumission déjà faite).', 'err');
    setBusy(true);
    try {
      if (existing) {
        let jobId: number | undefined;
        if (date) {
          jobId = await db.jobs.add({ ...blankJob(date, job.clientId), time, address, title: existing.title || what, items: existing.items });
          await db.docs.update(existing.id!, { jobId, jobDate: date });
        }
        setRes({ quoteId: existing.id, jobId, number: existing.number, total: docTotals(existing, s).total, summary: `Soumission ${existing.number} gardée${date ? `, travaux planifiés le ${formatDate(date)}` : ''}.` });
      } else {
        const r = await createFromAi({
          type: 'soumission', clientId: job.clientId, name: client?.name ?? '', phone: client?.phone ?? '', address, date: date || todayISO(), time, hasDate: !!date,
          items: [{ code: '', description: what.trim() || 'Travaux', quantity: 1, unitPrice: price }], ask: what, detailed, tax, newJob: true,
        });
        setRes(r);
      }
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (res) {
    return (
      <Modal title="Estimation terminée" onClose={onClose}>
        <div className="done-hero"><CircleCheck size={44} /><div><strong>{client?.name ?? 'Client'}</strong><div className="small muted">{res.summary}</div></div></div>
        <div className="done-actions">
          {res.quoteId && <button className="done-btn primary" onClick={() => nav(`/doc/${res.quoteId}`)}><span><strong>Ouvrir la soumission</strong><small>Relire, ajuster et l’envoyer au client</small></span></button>}
          {res.jobId && <button className="done-btn" onClick={() => nav(`/job/${res.jobId}`)}><span><strong>Voir la job des travaux</strong><small>Planifiée à l’agenda</small></span></button>}
        </div>
        <button className="btn block" style={{ marginTop: 10 }} onClick={onClose}>Fermer</button>
      </Modal>
    );
  }

  return (
    <Modal title="Estimation terminée" onClose={onClose}>
      <div className="done-hero"><CircleCheck size={44} /><div><strong>{client?.name ?? 'Client'}</strong><div className="small muted">{address || 'Estimation faite'}</div></div></div>
      <div className="form-grid">
        {quotes.length > 0 && (
          <label className="field full">Ta soumission de l’estimation
            <select value={quoteId} onChange={(e) => setQuoteId(Number(e.target.value))}>
              <option value={0}>Nouvelle soumission</option>
              {quotes.map((q) => <option key={q.id} value={q.id}>{q.number} — {q.title || 'Soumission'} ({money(docTotals(q, s).total)})</option>)}
            </select>
          </label>
        )}
        {!existing && (
          <>
            <label className="field full">C’est combien? (prix avant taxes si tu ajoutes les taxes)<NumInput value={price} placeholder="0" onChange={(n) => setPrice(n ?? 0)} /></label>
            <div className="full"><TaxMode doc={tax} onChange={(t) => setTax({ applyTps: t.applyTps, applyTvq: t.applyTvq, taxIncluded: !!t.taxIncluded })} /></div>
            <label className="field full">Les travaux (ce que tu vas faire)<textarea rows={3} value={what} placeholder="ex.: Calfeutrage extérieur de 6 ouvertures, couleur Stone" onChange={(e) => setWhat(e.target.value)} /></label>
            <label className="check full"><input type="checkbox" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} /> Devis détaillé (texte complet, ouvertures, conditions)</label>
          </>
        )}
        <label className="field">Journée des travaux<input type="date" value={date} min={todayISO()} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">Heure<input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
      </div>
      <div className="small muted" style={{ margin: '6px 0 10px' }}>Pas de date pour l’instant? Laisse vide: la soumission est créée, tu planifieras plus tard.</div>
      <button className="btn accent block" disabled={busy} onClick={() => void save()}>{busy ? 'Un instant…' : existing ? (date ? 'Garder la soumission et planifier les travaux' : 'Garder cette soumission') : date ? 'Créer la soumission et planifier les travaux' : 'Créer la soumission'}</button>
      <button className="btn block" style={{ marginTop: 8 }} onClick={onClose}>Plus tard</button>
    </Modal>
  );
}
