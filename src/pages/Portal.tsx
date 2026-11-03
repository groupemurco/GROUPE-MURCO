import { CircleCheck, Copy, CreditCard, Download, ExternalLink, PenLine, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { SignaturePad } from '../components/SignaturePad';
import { applyAccent } from '../lib/accent';
import { errMsg, useToast } from '../components/Toast';
import { DEFAULT_SETTINGS, type Doc, type Settings } from '../lib/db';
import { buildDocPdf } from '../lib/pdf';
import { loadPortal, reviewPortal, signPortal, startCardPayment, type PortalData } from '../lib/portal';
import type { Review } from '../lib/db';
import { dateFor, moneyFor, unitFor, type DocLang } from '../lib/docLang';
import { downloadBlob, lineAmount } from '../lib/utils';
import { devisItems, devisTitle, sectionTotalText, type Devis } from '../lib/devis';

/** Page publique envoyée au client: voir, accepter (signer) et payer. */
export default function Portal() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const cfg = params.get('c');
  const notify = useToast();
  const [p, setP] = useState<PortalData | null | undefined>(undefined);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [sig, setSig] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadPortal(token, cfg).then(setP).catch((e) => setErr(errMsg(e)));
  }, [token, cfg]);
  useEffect(() => {
    if (p?.company.color) applyAccent(p.company.color);
  }, [p]);

  if (err) return <div className="portal"><div className="notice err">{err}</div></div>;
  if (p === undefined) return <div className="portal"><div className="empty">Chargement… / Loading…</div></div>;
  if (p === null) return <div className="portal"><div className="notice err">Ce lien n’est plus valide. Communique avec l’entreprise pour en recevoir un nouveau. / This link is no longer valid. Please contact the business for a new one.</div></div>;

  const d = p.doc;
  const t = d.totals;
  const lang: DocLang = p.lang ?? 'fr';
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);
  const money = (n: number) => moneyFor(n, lang);
  const formatDate = (iso: string) => dateFor(iso, lang);
  const isQuote = d.kind === 'quote';
  const signed = !!p.signature;

  const pdf = () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      companyName: p.company.name,
      legalName: p.company.legalName,
      ownerName: p.company.owner,
      address: p.company.lines[0] ?? '',
      city: p.company.lines[1] ?? '',
      province: '',
      postalCode: '',
      phone: p.company.phone,
      email: p.company.email,
      logo: p.company.logo,
      brandColor: p.company.color,
      paymentInstructions: p.company.paymentInstructions,
      invoiceConditions: p.company.conditions,
      tpsRate: p.company.tpsRate,
      tvqRate: p.company.tvqRate,
      tpsNumber: p.company.tpsNumber,
      tvqNumber: p.company.tvqNumber,
      chargeTaxes: p.company.chargeTaxes,
      website: p.company.website ?? '',
      tagline: p.company.tagline,
    };
    const docObj: Doc = {
      type: d.kind, number: d.number, clientId: 0, date: d.date, dueDate: d.dueDate, jobDate: d.jobDate, jobAddress: d.jobAddress, title: d.title,
      items: d.items, devis: d.devis ?? undefined, taxIncluded: d.taxIncluded, applyTps: d.applyTps, applyTvq: d.applyTvq, discount: d.discount, deposit: d.deposit, notes: d.notes, status: d.status, payments: [],
      signature: p.signature ?? undefined, createdAt: '', updatedAt: '', lang,
    };
    const blob = buildDocPdf(docObj, { name: p.client.name, address: p.client.address, contact: '', email: '', phone: '', notes: '', createdAt: '' }, settings).output('blob');
    downloadBlob(blob, `${isQuote ? L('Soumission', 'Quote') : L('Facture', 'Invoice')}_${d.number}.pdf`);
  };

  const accept = async () => {
    if (name.trim().length < 2) return notify(L('Écris ton nom complet.', 'Enter your full name.'), 'err');
    if (!sig) return notify(L('Signe dans le cadre.', 'Sign in the box.'), 'err');
    if (!agree) return notify(L('Coche la case pour confirmer.', 'Check the box to confirm.'), 'err');
    setBusy(true);
    try {
      const signature = { name: name.trim(), at: new Date().toISOString(), image: sig };
      await signPortal(token, cfg, signature);
      setP({ ...p, signature });
      notify(L('Merci! Ta soumission est acceptée.', 'Thank you! Your quote is accepted.'));
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const interac = p.company.paymentInstructions.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  const paidOnline = (p.cardPayments ?? []).reduce((a, x) => a + x.amount, 0);
  const due = Math.max(0, Math.round(((t.balance || t.total) - paidOnline) * 100) / 100);
  const justPaid = params.get('paid') === '1';
  const payCard = async () => {
    setBusy(true);
    try {
      location.href = await startCardPayment(p);
    } catch (e) {
      notify(errMsg(e), 'err');
      setBusy(false);
    }
  };

  return (
    <div className="portal">
      <div className="portal-head">
        <div>
          {p.company.logo && <img src={p.company.logo} alt="" style={{ maxHeight: 54, maxWidth: 200, display: 'block', marginBottom: 8 }} />}
          <div className="co">{p.company.name}</div>
          <div className="small muted">{[...p.company.lines, p.company.phone, p.company.email].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="doc">
          <div className="k">{isQuote ? L('SOUMISSION', 'QUOTE') : L('FACTURE', 'INVOICE')}</div>
          <div className="small">{L('No', 'No.')} {d.number} · {formatDate(d.date)}</div>
          <div className="small muted">{isQuote ? `${L('Valide jusqu’au', 'Valid until')} ${formatDate(d.dueDate)}` : d.dueDate <= d.date ? L('Payable sur réception', 'Due upon receipt') : `${L('Échéance', 'Due')} ${formatDate(d.dueDate)}`}</div>
        </div>
      </div>

      <div className="card">
        <div className="small muted">{isQuote ? L('Préparée pour', 'Prepared for') : L('Facturée à', 'Bill to')}</div>
        <div style={{ fontWeight: 700 }}>{p.client.name}</div>
        {d.jobAddress && <div className="small muted">{L('Lieu des travaux', 'Job site')}: {d.jobAddress}</div>}
        {d.devis ? <PortalDevis devis={d.devis} company={p.company} lang={lang} total={t} taxIncluded={!!d.taxIncluded} taxed={d.applyTps || d.applyTvq} money={money} /> : <>
        {d.title && <h2 style={{ marginTop: 12 }}>{d.title}</h2>}
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Service</th><th className="num">{L('Qté', 'Qty')}</th><th className="num hide-mobile">{L('Prix', 'Price')}</th><th className="num">{L('Montant', 'Amount')}</th></tr></thead>
            <tbody>
              {d.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.code && <b style={{ color: 'var(--amber-ink)', marginRight: 6 }}>{it.code}</b>}{it.description}</td>
                  <td className="num">{it.quantity} {unitFor(it.unit, lang)}</td>
                  <td className="num hide-mobile">{money(it.unitPrice)}</td>
                  <td className="num">{money(lineAmount(it))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="totals" style={{ marginTop: 12 }}>
          {t.discount > 0 && <div><span>{L('Rabais', 'Discount')}</span><span>−{money(t.discount)}</span></div>}
          {d.applyTps && <div><span>{L('TPS', 'GST')}{d.taxIncluded ? L(' incluse', ' included') : ''}</span><span>{money(t.tps)}</span></div>}
          {d.applyTvq && <div><span>{L('TVQ', 'QST')}{d.taxIncluded ? L(' incluse', ' included') : ''}</span><span>{money(t.tvq)}</span></div>}
          <div className="grand"><span>Total{d.taxIncluded ? L(' (taxes incluses)', ' (taxes included)') : ''}</span><span>{money(t.total)}</span></div>
          {t.deposit > 0 && <div><span>{L('Dépôt reçu', 'Deposit received')}</span><span>−{money(t.deposit)}</span></div>}
          {!isQuote && t.paid > 0 && <div className="grand"><span>{L('Solde', 'Balance')}</span><span>{money(t.balance)}</span></div>}
        </div>
        {d.notes && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{d.notes}</p>}
        </>}
        <button className="btn" onClick={pdf}><Download size={16} /> {L('Télécharger le PDF', 'Download PDF')}</button>
      </div>

      {(params.get('avis') === '1' || p.review) && !isQuote && <ReviewCard p={p} token={token} cfg={cfg} onDone={(review) => setP({ ...p, review })} />}

      {isQuote && (
        <div className="card">
          {signed ? (
            <div className="row" style={{ gap: 12 }}>
              <CircleCheck size={36} color="var(--green)" />
              <div>
                <div style={{ fontWeight: 700 }}>{L('Soumission acceptée', 'Quote accepted')}</div>
                <div className="small muted">{L('par', 'by')} {p.signature!.name} {L('le', 'on')} {new Date(p.signature!.at).toLocaleString(lang === 'en' ? 'en-CA' : 'fr-CA')}</div>
              </div>
            </div>
          ) : (
            <>
              <h2><PenLine size={18} style={{ verticalAlign: '-3px' }} /> {L('Accepter la soumission', 'Accept the quote')}</h2>
              <div className="grid" style={{ gap: 12 }}>
                <label className="field">{L('Ton nom complet', 'Your full name')}<input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} /></label>
                <SignaturePad onChange={setSig} lang={lang} typedName={name} />
                <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {L('J’accepte les travaux et le prix de', 'I accept the work and the price of')} {money(t.total)}.</label>
                <button className="btn accent big" disabled={busy} onClick={accept}>{busy ? L('Envoi…', 'Sending…') : L('Accepter et signer', 'Accept and sign')}</button>
              </div>
            </>
          )}
        </div>
      )}

      {!isQuote && (
        <div className="card">
          <h2>{L('Comment payer', 'How to pay')}</h2>
          {(justPaid || (paidOnline > 0 && due <= 0)) && (
            <div className="notice ok row"><CircleCheck size={18} /> {L('Merci! Votre paiement par carte', 'Thank you! Your card payment')} {justPaid && !paidOnline ? L('est en cours de confirmation', 'is being confirmed') : L(`de ${money(paidOnline)} est reçu`, `of ${money(paidOnline)} was received`)}.</div>
          )}
          {p.company.cardPayments && due > 0 && !justPaid && (
            <div style={{ marginBottom: 14 }}>
              <button className="btn accent big block" disabled={busy} onClick={payCard}><CreditCard size={20} /> {busy ? L('Ouverture…', 'Opening…') : L(`Payer ${money(due)} par carte`, `Pay ${money(due)} by card`)}</button>
              <div className="small muted" style={{ marginTop: 6, textAlign: 'center' }}>Visa, Mastercard, Amex, Apple Pay, Google Pay — {L('paiement sécurisé par Stripe', 'secure payment by Stripe')}</div>
            </div>
          )}
          <p style={{ marginTop: 0 }}>{p.company.cardPayments && due > 0 ? L('Ou par: ', 'Or by: ') : ''}{p.company.paymentInstructions}</p>
          {interac && (
            <div className="row">
              <span>{L('Courriel Interac', 'Interac email')}: <strong>{interac}</strong></span>
              <button className="btn small" onClick={async () => { try { await navigator.clipboard.writeText(interac); notify(L('Courriel copié', 'Email copied')); } catch { notify(interac); } }}><Copy size={15} /> {L('Copier', 'Copy')}</button>
            </div>
          )}
          <p className="small muted">{L('Montant', 'Amount')}: <strong>{money(t.balance || t.total)}</strong> · {L('Référence', 'Reference')}: {d.number}</p>
          {p.company.conditions && <p className="small muted">{p.company.conditions}</p>}
        </div>
      )}
      <p className="small muted" style={{ textAlign: 'center' }}>{p.company.legalName} · <a href="#/confidentialite" target="_blank" rel="noreferrer">{L('Confidentialité', 'Privacy')}</a></p>
    </div>
  );
}

/** Avis du client: 4-5 étoiles → invitation à publier sur Google; 1-3 → commentaire privé à l'entreprise. */
function ReviewCard({ p, token, cfg, onDone }: { p: PortalData; token: string; cfg: string | null; onDone: (r: Review) => void }) {
  const notify = useToast();
  const L = (fr: string, en: string) => (p.lang === 'en' ? en : fr);
  const [stars, setStars] = useState(p.review?.stars ?? 0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const done = !!p.review;
  const send = async (review: Review) => {
    setBusy(true);
    try {
      await reviewPortal(token, cfg, review);
      onDone(review);
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <h2>{L('Comment s’est passé le travail?', 'How did the job go?')}</h2>
      <div className="stars" role="radiogroup" aria-label="Note">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={n <= stars ? 'on' : ''} disabled={done} aria-label={L(`${n} étoile${n > 1 ? 's' : ''}`, `${n} star${n > 1 ? 's' : ''}`)} onClick={() => setStars(n)}>
            <Star size={36} fill={n <= stars ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
      {done ? (
        <p>{L('Merci pour ton avis!', 'Thanks for your feedback!')}</p>
      ) : stars >= 4 ? (
        <div style={{ marginTop: 10 }}>
          <p>{L('Merci! Ça nous aiderait beaucoup que tu le dises aussi sur Google (30 secondes).', 'Thank you! It would help us a lot if you shared it on Google too (30 seconds).')}</p>
          {p.company.reviewUrl ? (
            <a className="btn accent big block" href={p.company.reviewUrl} target="_blank" rel="noreferrer" onClick={() => void send({ stars, at: new Date().toISOString(), toGoogle: true })}><ExternalLink size={18} /> {L('Laisser un avis Google', 'Leave a Google review')}</a>
          ) : (
            <button className="btn accent big block" disabled={busy} onClick={() => send({ stars, at: new Date().toISOString() })}>{L('Envoyer', 'Send')}</button>
          )}
        </div>
      ) : stars > 0 ? (
        <div style={{ marginTop: 10, textAlign: 'left' }}>
          <label className="field">{L(`Qu’est-ce qu’on pourrait améliorer? (seulement ${p.company.name} le voit)`, `What could we improve? (only ${p.company.name} sees this)`)}
            <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <button className="btn accent block" style={{ marginTop: 8 }} disabled={busy} onClick={() => send({ stars, comment: comment.trim() || undefined, at: new Date().toISOString() })}>{L('Envoyer', 'Send')}</button>
        </div>
      ) : null}
    </div>
  );
}

/** Devis détaillé tel que le client le lit (mêmes sections que le PDF). */
function PortalDevis({ devis, company, lang, total, taxIncluded, taxed, money }: {
  devis: Devis; company: PortalData['company']; lang: DocLang; total: PortalData['doc']['totals']; taxIncluded: boolean; taxed: boolean; money: (n: number) => string;
}) {
  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);
  const Section = ({ title, items, extra }: { title: string; items: string[]; extra?: string }) => {
    const list = devisItems(items);
    if (!list.length) return null;
    return (
      <div className="pd-sec">
        {title.trim() && <h3>{title}</h3>}
        <ul>{list.map((x, i) => <li key={i}>{x}</li>)}</ul>
        {extra && <div className="pd-total">{extra}</div>}
      </div>
    );
  };
  return (
    <div className="portal-devis">
      <h2>{devisTitle(company.name, devis)}</h2>
      {devis.sections.map((sec, i) => <Section key={i} title={sec.title} items={sec.items} extra={sectionTotalText(sec)} />)}
      <div className="pd-price">
        <div>
          <small>{devis.priceLabel || L('Prix forfaitaire proposé', 'Proposed flat price')}</small>
          {(taxIncluded || taxed) && <span>{taxIncluded ? L('taxes incluses', 'taxes included') : L('plus taxes', 'plus taxes')}</span>}
        </div>
        <b>{money(taxIncluded || !taxed ? total.total : total.subtotal)}</b>
      </div>
      {taxed && !taxIncluded && <div className="small muted">{L('Total avec les taxes', 'Total with taxes')}: <b>{money(total.total)}</b></div>}
      {devis.priceNote.trim() && <p className="pd-note">{devis.priceNote}</p>}
      <Section title="Conditions" items={devis.conditions} />
      {devis.closing.trim() && <p>{devis.closing}</p>}
      <div className="pd-sign">
        <b>{company.owner}</b>
        <span>{company.name}</span>
        {company.tagline && <span className="muted">{company.tagline}</span>}
        {company.website && <span>{company.website}</span>}
      </div>
    </div>
  );
}
