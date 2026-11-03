import { useLiveQuery } from 'dexie-react-hooks';
import { Banknote, Bell, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { CountUp } from '../components/CountUp';
import { PageHero, Ring } from '../components/PageHero';
import { celebrate } from '../lib/feel';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PreviewButton } from '../components/DocPreview';
import { RelanceModal } from '../components/RelanceModal';
import { SwipeRow } from '../components/SwipeRow';
import { useToast } from '../components/Toast';
import { db, type Doc, type DocType } from '../lib/db';
import { PaymentModal } from './DocEditor';
import { useSettings } from '../lib/hooks';
import { docTotals, money, statusClass, statusLabel, todayISO } from '../lib/utils';

const FILTERS: Record<DocType, { key: string; label: string }[]> = {
  invoice: [
    { key: 'all', label: 'Toutes' },
    { key: 'unpaid', label: 'À encaisser' },
    { key: 'late', label: 'En retard' },
    { key: 'paid', label: 'Payées' },
    { key: 'draft', label: 'Brouillons' },
  ],
  quote: [
    { key: 'all', label: 'Toutes' },
    { key: 'sent', label: 'En attente' },
    { key: 'accepted', label: 'Acceptées' },
    { key: 'refused', label: 'Refusées' },
    { key: 'draft', label: 'Brouillons' },
  ],
};

export default function DocList({ type }: { type: DocType }) {
  const nav = useNavigate();
  const s = useSettings();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const notify = useToast();
  const [pay, setPay] = useState<Doc | null>(null);
  const [relance, setRelance] = useState<Doc | null>(null);
  const data = useLiveQuery(async () => {
    const [docs, clients] = await Promise.all([db.docs.where('type').equals(type).toArray(), db.clients.toArray()]);
    return { docs: docs.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)), clients: new Map(clients.map((c) => [c.id!, c])) };
  }, [type]);
  if (!data) return null;
  const today = todayISO();
  const isInvoice = type === 'invoice';

  const rows = data.docs.filter((d) => {
    const c = data.clients.get(d.clientId);
    const text = `${d.number} ${d.title} ${d.jobAddress} ${c?.name ?? ''}`.toLowerCase();
    if (q && !text.includes(q.toLowerCase())) return false;
    switch (filter) {
      case 'unpaid': return d.status === 'sent' || d.status === 'partial';
      case 'late': return (d.status === 'sent' || d.status === 'partial') && d.dueDate < today;
      case 'all': return true;
      default: return d.status === filter;
    }
  });
  const total = rows.reduce((a, d) => a + docTotals(d, s).total, 0);

  // Bandeau: l'argent qui s'en vient
  const month = today.slice(0, 7);
  const live = data.docs.filter((d) => d.status !== 'draft' && d.status !== 'cancelled');
  const open = live.filter((d) => d.status === 'sent' || d.status === 'partial');
  const late = open.filter((d) => d.dueDate < today);
  const bal = (list: Doc[]) => list.reduce((a, d) => a + docTotals(d, s).balance, 0);
  const tot = (list: Doc[]) => list.reduce((a, d) => a + docTotals(d, s).total, 0);
  // Encaissé ce mois: paiements datés du mois, dépôts des factures du mois, et anciennes factures « Payée » sans paiement inscrit
  const paidMonth = isInvoice
    ? live.reduce((a, d) => {
        const t = docTotals(d, s);
        let x = d.payments.filter((p) => p.date.startsWith(month)).reduce((y, p) => y + p.amount, 0);
        if (t.deposit > 0 && d.date.startsWith(month)) x += t.deposit;
        if (d.status === 'paid' && !d.payments.length && t.balance > 0.004 && (d.updatedAt || d.date).startsWith(month)) x += t.balance;
        return a + x;
      }, 0)
    : 0;
  const billedMonth = tot(live.filter((d) => d.date.startsWith(month)));
  const decided = live.filter((d) => d.status === 'accepted' || d.status === 'refused' || d.convertedInvoiceId);
  const won = decided.filter((d) => d.status === 'accepted' || d.convertedInvoiceId);
  const winRate = decided.length ? won.length / decided.length : 0;

  return (
    <>
      <PageHero
        eyebrow={isInvoice ? 'Factures' : 'Soumissions'}
        title={isInvoice
          ? (open.length ? <><CountUp value={bal(open)} format={money} /> à recevoir</> : 'Tout est encaissé 🎉')
          : (open.length ? <><CountUp value={tot(open)} format={money} /> en attente</> : 'Aucune soumission en attente')}
        sub={isInvoice
          ? `${open.length} facture${open.length > 1 ? 's' : ''} ouverte${open.length > 1 ? 's' : ''}${late.length ? ` · ${late.length} en retard` : ''}`
          : `${open.length} soumission${open.length > 1 ? 's' : ''} envoyée${open.length > 1 ? 's' : ''} sans réponse`}
        actions={<>
          {!isInvoice && <button className="agh-btn" onClick={() => nav('/soumission-ia')}><Sparkles size={16} /> Soumission IA</button>}
          <button className="agh-btn solid" onClick={() => nav(`/doc/new?type=${type}${isInvoice ? '' : '&format=lignes'}`)}><Plus size={16} /> {isInvoice ? 'Facture' : 'Soumission'}</button>
        </>}
      >
        <div className="agh-row">
          {isInvoice ? (
            <Ring big value={billedMonth ? paidMonth / billedMonth : 0} label="Encaissé ce mois-ci">
              <b>{billedMonth ? Math.min(100, Math.round((paidMonth / billedMonth) * 100)) : 0} %</b>encaissé
            </Ring>
          ) : (
            <Ring big value={winRate} label="Taux d’acceptation"><b>{Math.round(winRate * 100)} %</b>acceptées</Ring>
          )}
          <div className="agh-stats">
            {isInvoice ? (
              <>
                <div><b>{money(paidMonth)}</b><span>encaissé ce mois</span></div>
                <div><b>{money(billedMonth)}</b><span>facturé ce mois</span></div>
                {late.length > 0 && <button className="agh-stat-btn warn" onClick={() => setFilter('late')}><b>{money(bal(late))}</b><span>en retard</span></button>}
              </>
            ) : (
              <>
                <div><b>{won.length}</b><span>acceptée{won.length > 1 ? 's' : ''}</span></div>
                <div><b>{money(billedMonth)}</b><span>soumis ce mois</span></div>
                {open.length > 0 && <button className="agh-stat-btn" onClick={() => setFilter('sent')}><b>{open.length}</b><span>à relancer</span></button>}
              </>
            )}
          </div>
        </div>
      </PageHero>
      <div className="tabs">
        {FILTERS[type].map((f) => (
          <button key={f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      <div className="card">
        <input placeholder="Rechercher (no, client, job, adresse)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
        {rows.length === 0 ? (
          <div className="empty">Aucune {isInvoice ? 'facture' : 'soumission'} ici.</div>
        ) : (
          <>
          <div className="doc-cards hide-desktop">
            {rows.map((d) => {
              const tt = docTotals(d, s);
              const c = data.clients.get(d.clientId);
              const open = d.status === 'sent' || d.status === 'partial';
              const late = open && d.dueDate < today;
              return (
                <SwipeRow key={d.id} onTap={() => nav(`/doc/${d.id}`)}
                  left={isInvoice && open ? { label: 'Payée', icon: <Banknote size={18} />, tone: 'green', run: () => setPay(d) } : undefined}
                  right={open ? { label: 'Relancer', icon: <Bell size={18} />, tone: 'amber', run: () => setRelance(d) } : undefined}>
                  <div className={`doc-card ${late ? 'late' : ''}`}>
                    <span className="cp-avatar">{(c?.name ?? '?').slice(0, 1).toUpperCase()}</span>
                    <span className="grow">
                      <strong>{c?.name ?? '—'}</strong>
                      <small>{d.number}{d.title ? ` · ${d.title}` : ''}</small>
                      <span className="row" style={{ gap: 6, marginTop: 3 }}>
                        <span className={statusClass(d)}>{statusLabel(d)}</span>
                        {late && <span className="badge red">En retard</span>}
                        <PreviewButton doc={d} client={c} compact />
                      </span>
                    </span>
                    <span className="doc-amt">
                      <b>{money(tt.total)}</b>
                      {isInvoice && tt.paid > 0 && tt.balance > 0 && <small>solde {money(tt.balance)}</small>}
                      <small>{d.date}</small>
                    </span>
                    <ChevronRight size={16} className="muted" />
                  </div>
                </SwipeRow>
              );
            })}
            <div className="doc-cards-foot"><span>{rows.length} {isInvoice ? 'facture' : 'soumission'}{rows.length > 1 ? 's' : ''}</span><strong>{money(total)}</strong></div>
            {rows.some((d) => d.status === 'sent' || d.status === 'partial') && <div className="small muted swipe-hint">Astuce: glisse une {isInvoice ? 'facture vers la droite pour la marquer payée, vers la gauche' : 'soumission vers la gauche'} pour relancer le client.</div>}
          </div>
          <div className="table-wrap hide-mobile">
            <table className="list">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Client / Job</th>
                  <th className="hide-mobile">Date</th>
                  <th>Statut</th>
                  <th className="num">Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const tt = docTotals(d, s);
                  return (
                    <tr key={d.id} className="click" onClick={() => nav(`/doc/${d.id}`)}>
                      <td><strong>{d.number}</strong></td>
                      <td>
                        {data.clients.get(d.clientId)?.name ?? '—'}
                        <div className="small muted">{d.title}{d.jobAddress ? ` · ${d.jobAddress}` : ''}</div>
                      </td>
                      <td className="hide-mobile">{d.date}</td>
                      <td><span className={statusClass(d)}>{statusLabel(d)}</span></td>
                      <td className="num">
                        {money(tt.total)}
                        {isInvoice && tt.paid > 0 && tt.balance > 0 && <div className="small muted">solde {money(tt.balance)}</div>}
                      </td>
                      <td style={{ width: 1 }}><PreviewButton doc={d} client={data.clients.get(d.clientId)} /></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={3} className="hide-mobile"></td><td><strong>Total</strong></td><td className="num"><strong>{money(total)}</strong></td><td></td></tr>
              </tfoot>
            </table>
          </div>
          </>
        )}
      </div>
      {pay && (
        <PaymentModal balance={docTotals(pay, s).balance} link={{ docId: pay.id, clientId: pay.clientId }} onClose={() => setPay(null)} onSave={async (p) => {
          const payments = [...pay.payments, p];
          const tt = docTotals({ ...pay, payments }, s);
          await db.docs.update(pay.id!, { payments, status: tt.balance <= 0.004 ? 'paid' : 'partial' });
          if (tt.balance <= 0.004) celebrate();
          notify(tt.balance <= 0.004 ? `${pay.number} payée — ${money(p.amount)}` : `Paiement de ${money(p.amount)} — solde ${money(tt.balance)}`);
          setPay(null);
        }} />
      )}
      {relance && <RelanceModal doc={relance} client={data.clients.get(relance.clientId)} onClose={() => setRelance(null)} />}
    </>
  );
}
