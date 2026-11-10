import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AddressInput } from '../components/AddressInput';
import { ClientPicker } from '../components/ClientPicker';
import { ClientFormModal } from '../components/ClientForm';
import { clientDocMessage, companyTexts, dateFor, docLangOf, firstName, greeting, isEvening, moneyFor } from '../lib/docLang';
import { emptyLine, LineItems } from '../components/LineItems';
import { TaxMode } from '../components/TaxMode';
import { Modal } from '../components/Modal';
import { SendEmailModal } from '../components/SendEmailModal';
import { errMsg, useConfirm, useToast } from '../components/Toast';
import { db, getSettings, saveSettings, takeNextNumber, type Client, type Doc, type DocStatus, type DocType } from '../lib/db';
import { DevisEditor, devisPriceItems, starterDevis, takeQuestions } from '../components/DevisEditor';
import { directionsLink, embedDirectionsUrl } from '../lib/geo';
import { useSettings } from '../lib/hooks';
import { docFileName } from '../lib/pdf';
import { makeDocPdf } from '../lib/docPdf';
import { isNative, shareFiles, shareLink } from '../lib/native';
import { publishPortal, reviewLink } from '../lib/portal';
import { PortalStatus } from '../components/PortalStatus';
import { profitOfDoc } from '../lib/profit';
import { syncLeadFromDoc } from '../lib/crm';
import { useSyncState } from '../lib/sync';
import { smsLink, syncJobFromDoc } from '../lib/agenda';
import { MediaGallery, ProofPhoto } from '../components/MediaGallery';
import { Banknote, Check, CircleCheck, CreditCard, Pencil, TriangleAlert, Copy, Download, Eye, Link2, Mail, MessageSquare, Plus, Save, Share2, Star, Trash2, Navigation, RefreshCw, TrendingUp, FileText } from 'lucide-react';
import { deleteDocCascade, syncTripForDoc } from '../lib/trips';
import { addDays, METHOD_LABEL, docTotals, downloadBlob, formatDate, km, money, round2, STATUS_LABELS, statusClass, statusLabel, todayISO } from '../lib/utils';
import { celebrate } from '../lib/feel';
import { NumInput } from '../components/NumInput';
import { canTextHere, SmsFromComputer } from '../components/TextSender';
import { PdfView } from '../components/PdfView';

function newDoc(type: DocType, clientId: number, s: Awaited<ReturnType<typeof getSettings>>, format?: string | null): Doc {
  const date = todayISO();
  const now = new Date().toISOString();
  // Soumission en devis détaillé (le dernier format utilisé, ou ?format=devis)
  const devis = type === 'quote' && (format ?? s.quoteFormat) === 'devis' ? starterDevis() : undefined;
  return {
    type,
    number: '',
    clientId,
    date,
    dueDate: addDays(date, type === 'invoice' ? s.paymentTermsDays : s.quoteValidityDays),
    jobDate: type === 'invoice' ? date : '',
    jobAddress: '',
    title: '',
    items: devis ? devisPriceItems(devis, 0) : [emptyLine()],
    ...(devis ? { devis, taxIncluded: true } : {}),
    applyTps: s.chargeTaxes,
    applyTvq: s.chargeTaxes,
    notes: type === 'invoice' ? s.invoiceNotes : s.quoteNotes,
    status: 'draft',
    payments: [],
    createdAt: now,
    updatedAt: now,
  };
}

export default function DocEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const notify = useToast();
  const ask = useConfirm();
  const s = useSettings();
  const isNew = id === 'new';

  const [doc, setDoc] = useState<Doc | null>(null);
  // Le formulaire affiché doit correspondre à la page (évite d'enregistrer l'ancien document sur « Nouvelle facture »)
  const loadKey = `${id}|${params.toString()}`;
  const [loadedFor, setLoadedFor] = useState('');
  const [savedAddress, setSavedAddress] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  // Arrivée depuis « Job terminée → envoyer par courriel »: ouvrir l'envoi tout de suite
  const autoSend = useRef(false);
  const openEmailRef = useRef<() => void>(() => undefined);
  // Arrivée depuis « Soumission IA »: la soumission s'affiche tout de suite, prête à envoyer
  const autoReady = useRef(false);
  const readyRef = useRef<() => void>(() => undefined);
  const [questions] = useState(takeQuestions);
  useEffect(() => {
    if (params.get('envoyer') === 'courriel' && loadedFor === loadKey && !autoSend.current) {
      autoSend.current = true;
      openEmailRef.current();
    }
  }, [loadedFor, loadKey, params]);
  const [isMobile] = useState(() => matchMedia('(max-width: 860px)').matches);
  const [moreOpen, setMoreOpen] = useState(() => !matchMedia('(max-width: 860px)').matches);
  const [emailPdf, setEmailPdf] = useState<Blob | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [askPhone, setAskPhone] = useState<Client | null>(null);
  const [smsPc, setSmsPc] = useState<{ phone: string; text: string; name?: string } | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [readyView, setReadyView] = useState<{ doc: Doc; blob: Blob; saved: boolean } | null>(null);

  const clients = useLiveQuery(() => db.clients.orderBy('name').toArray(), []) ?? [];
  const services = useLiveQuery(() => db.services.orderBy('order').toArray(), []) ?? [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const members = useLiveQuery(() => db.members.toArray(), []) ?? [];
  const trip = useLiveQuery(() => (doc?.tripId ? db.trips.get(doc.tripId) : undefined), [doc?.tripId]);
  const emails = useLiveQuery(() => (doc?.id ? db.emails.where('docId').equals(doc.id).toArray() : []), [doc?.id]) ?? [];
  const linked = useLiveQuery(async () => {
    if (!doc) return {};
    const src = doc.sourceQuoteId ? await db.docs.get(doc.sourceQuoteId) : undefined;
    const conv = doc.convertedInvoiceId ? await db.docs.get(doc.convertedInvoiceId) : undefined;
    return { src, conv };
  }, [doc?.sourceQuoteId, doc?.convertedInvoiceId]);

  useEffect(() => {
    (async () => {
      if (isNew) {
        const st = await getSettings();
        const type = (params.get('type') as DocType) || 'invoice';
        setDoc({ ...newDoc(type, Number(params.get('client')) || 0, st, params.get('format')), projectId: Number(params.get('project')) || undefined });
        setSavedAddress('');
        setDirty(false);
        setLoadedFor(`${id}|${params.toString()}`);
      } else {
        const d = await db.docs.get(Number(id));
        if (!d) return nav('/factures');
        setDoc(d);
        setSavedAddress(d.jobAddress);
        setDirty(false);
        setLoadedFor(`${id}|${params.toString()}`);
      }
    })();
  }, [id, isNew, params, nav]);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  // Mises à jour venant d'ailleurs (autre appareil, signature du client dans le portail)
  const live = useLiveQuery(() => (doc?.id ? db.docs.get(doc.id) : undefined), [doc?.id]);
  useEffect(() => {
    if (!live || !doc || live.id !== doc.id || live._u === doc._u) return;
    if (!dirty) setDoc(live);
    else setDoc((d) => (d ? { ...d, signature: live.signature, viewedAt: live.viewedAt, portalToken: live.portalToken, _u: live._u } : d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?._u]);

  const readyClient = doc ? clients.find((c) => c.id === doc.clientId) : undefined;
  useEffect(() => {
    if (params.get('pret') === '1' && loadedFor === loadKey && readyClient && !autoReady.current) {
      autoReady.current = true;
      readyRef.current();
    }
  }, [loadedFor, loadKey, params, readyClient]);

  if (!doc || loadedFor !== loadKey) return null;
  const client = clients.find((c) => c.id === doc.clientId);
  const L = docLangOf(doc, client);
  /** Client ou langue choisis: les notes par défaut suivent la langue du document. */
  const setLangPatch = (lang: 'fr' | 'en', patch: Partial<Doc> = {}) => {
    const key = isInvoice ? 'invoiceNotes' : 'quoteNotes';
    const fr = companyTexts(s, 'fr')[key];
    const en = companyTexts(s, 'en')[key];
    if (lang === 'en' && doc.notes === fr) patch.notes = en;
    if (lang === 'fr' && doc.notes === en) patch.notes = fr;
    upd(patch);
  };
  const tot = docTotals(doc, s);
  const isInvoice = doc.type === 'invoice';
  const kind = isInvoice ? 'Facture' : 'Soumission';

  const upd = (patch: Partial<Doc>) => {
    setDoc((d) => ({ ...d!, ...patch }));
    setDirty(true);
  };
  /** Changer la date garde le même délai d'échéance (et la date des travaux si elle suivait). */
  const changeDate = (date: string) => {
    if (!date) return;
    setDoc((d) => {
      const days = Math.round((new Date(d!.dueDate + 'T12:00:00').getTime() - new Date(d!.date + 'T12:00:00').getTime()) / 864e5);
      return { ...d!, date, dueDate: addDays(date, Number.isFinite(days) ? days : 0), jobDate: d!.jobDate === d!.date ? date : d!.jobDate };
    });
    setDirty(true);
  };

  /** Enregistre et retourne la version à jour (avec id et numéro). */
  const save = async (extra: Partial<Doc> = {}, quiet = false): Promise<Doc | null> => {
    if (!doc.clientId) {
      notify('Choisis un client.', 'err');
      return null;
    }
    setBusy(true);
    try {
      const toSave: Doc = {
        ...doc,
        ...extra,
        items: doc.items.filter((it) => it.description.trim() || it.unitPrice || it.code),
        updatedAt: new Date().toISOString(),
      };
      if (!toSave.items.length) toSave.items = [emptyLine()];
      if (!toSave.number) toSave.number = await takeNextNumber(toSave.type);
      if (toSave.jobAddress.trim() !== savedAddress.trim()) toSave.jobGeo = undefined;
      const newId = await db.docs.put(toSave);
      let saved = { ...toSave, id: newId };
      setSavedAddress(saved.jobAddress);
      try {
        const t = await syncTripForDoc(newId);
        if (t) {
          saved = { ...saved, tripId: t.id, jobGeo: (await db.docs.get(newId))?.jobGeo };
          if (!quiet) notify(`${kind} enregistrée · journal de bord: ${km(t.totalKm)}`);
        } else if (!quiet) notify(`${kind} enregistrée`);
      } catch (e) {
        notify(`${kind} enregistrée, mais km non calculés: ${errMsg(e)}`, 'err');
      }
      try {
        await syncJobFromDoc(newId);
        const fresh = await db.docs.get(newId);
        if (fresh) saved = { ...fresh, id: newId };
      } catch {
        /* l'agenda se mettra à jour plus tard */
      }
      setDoc(saved);
      setDirty(false);
      void syncLeadFromDoc(saved);
      if (isNew) {
        setLoadedFor(`${newId}|`);
        nav(`/doc/${newId}`, { replace: true });
      }
      return saved;
    } catch (e) {
      notify(errMsg(e), 'err');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const pdfBlob = (d: Doc) => makeDocPdf(d, client, s);
  const ready = async () => (dirty || !doc.id ? await save({}, true) : doc);

  /** Texto au client en un geste: lien en ligne + message personnalisé (prénom, job, Bonjour/Bonsoir). */
  const sendText = async () => {
    const d = await ready();
    if (!d) return;
    const c = await db.clients.get(d.clientId); // fiche à jour (le numéro vient peut-être d'être ajouté)
    if (!c) return notify('Choisis le client en haut.', 'err');
    if (!c.phone.trim()) {
      notify('Ajoute le cellulaire du client, puis Enregistrer: le texto partira ensuite.', 'err');
      return setAskPhone(c);
    }
    let link = '';
    try {
      link = await publishPortal(d.id!);
    } catch {
      notify('Texto sans lien en ligne: active la synchronisation pour que le client puisse voir et accepter en ligne.', 'err');
    }
    const tt = docTotals(d, s);
    const body = clientDocMessage({ kind: d.type, number: d.number, amount: tt.balance || tt.total, client: c, company: s.companyName, owner: s.ownerName, lang: docLangOf(d, c), link: link || undefined, job: d.title, address: d.jobAddress || c.address });
    if (canTextHere()) window.location.href = smsLink(c.phone, body);
    else setSmsPc({ phone: c.phone, text: body, name: c.name });
    // Marquée « Envoyée » après l'ouverture des textos (rien ne doit retarder l'ouverture)
    if (d.status === 'draft') void save({ status: 'sent', sentAt: new Date().toISOString() }, true);
  };
  const preview = async () => {
    const d = await ready();
    if (d) setReadyView({ doc: d, blob: await pdfBlob(d), saved: false });
  };
  const download = async () => {
    const d = await ready();
    if (d) downloadBlob(await pdfBlob(d), docFileName(d, client));
  };
  const openEmail = async () => {
    const d = await ready();
    if (d) setEmailPdf(await pdfBlob(d));
  };
  openEmailRef.current = () => void openEmail();
  readyRef.current = () => void preview();
  /** Partage du PDF (texto, Messenger, courriel…) avec la feuille de partage du téléphone. */
  const share = async () => {
    const d = await ready();
    if (!d) return;
    const blob = await pdfBlob(d);
    const ok = await shareFiles([{ blob, name: docFileName(d, client) }], `${kind} ${d.number}`, `${kind} ${d.number} — ${s.companyName} — ${money(docTotals(d, s).balance || docTotals(d, s).total)}`);
    if (ok) {
      if (d.status === 'draft') await save({ status: 'sent', sentAt: new Date().toISOString() }, true);
    } else {
      downloadBlob(blob, docFileName(d, client));
      notify('PDF téléchargé (le partage direct n’est pas disponible sur cet appareil).');
    }
  };

  const setStatus = async (status: DocStatus) => {
    await save({ status });
  };

  const convertToInvoice = async () => {
    const q = dirty || !doc.id ? await save({}, true) : doc;
    if (!q?.id) return;
    const st = await getSettings();
    const inv: Doc = {
      ...newDoc('invoice', q.clientId, st),
      title: q.title,
      jobAddress: q.jobAddress,
      jobGeo: q.jobGeo,
      // Devis: la ligne forfaitaire renvoie à la soumission (le texte détaillé reste sur la soumission)
      items: q.items.map((it) => ({ ...it, description: q.devis ? `${it.description} — selon la soumission ${q.number}` : it.description })),
      applyTps: q.applyTps,
      applyTvq: q.applyTvq,
      taxIncluded: q.taxIncluded,
      discount: q.discount,
      sourceQuoteId: q.id,
      // La job déjà planifiée à l'agenda suit la facture
      ...(q.jobId ? { jobId: q.jobId, jobDate: q.jobDate || todayISO() } : {}),
    };
    inv.number = await takeNextNumber('invoice');
    const invId = await db.docs.add(inv);
    await db.docs.update(q.id, { status: 'accepted', convertedInvoiceId: invId, updatedAt: new Date().toISOString() });
    if (q.jobId) await db.jobs.update(q.jobId, { docId: invId });
    void syncLeadFromDoc({ ...q, status: 'accepted', convertedInvoiceId: invId });
    if (!q.jobId) {
      try {
        await syncTripForDoc(invId);
      } catch (e) {
        notify(`Facture créée, km non calculés: ${errMsg(e)}`, 'err');
      }
    }
    notify(`Facture ${inv.number} créée à partir de la soumission`);
    nav(`/doc/${invId}`);
  };

  const duplicate = async () => {
    const st = await getSettings();
    const copy: Doc = { ...newDoc(doc.type, doc.clientId, st, 'lignes'), title: doc.title, jobAddress: doc.jobAddress, items: doc.items.map((i) => ({ ...i })), applyTps: doc.applyTps, applyTvq: doc.applyTvq, taxIncluded: doc.taxIncluded, discount: doc.discount, notes: doc.notes, devis: doc.devis && structuredClone(doc.devis), estimate: doc.estimate && structuredClone(doc.estimate) };
    copy.number = await takeNextNumber(copy.type);
    const nid = await db.docs.add(copy);
    notify(`Copie ${copy.number} créée`);
    nav(`/doc/${nid}`);
  };

  const remove = async () => {
    if (!doc.id) return nav(-1);
    if (!(await ask({ title: `Supprimer ${kind.toLowerCase()} ${doc.number}?`, message: 'Le déplacement automatique lié sera aussi supprimé.', confirm: 'Supprimer', danger: true }))) return;
    await deleteDocCascade(doc.id);
    notify(`${kind} supprimée`);
    nav(isInvoice ? '/factures' : '/soumissions');
  };

  const recalcTrip = async () => {
    const d = dirty || !doc.id ? await save({}, true) : doc;
    if (!d?.id) return;
    try {
      if (trip?.id && trip.distanceMethod === 'manuel') await db.trips.update(trip.id, { distanceMethod: 'route', toGeo: undefined });
      const t = await syncTripForDoc(d.id, { force: true });
      if (t) {
        setDoc({ ...d, tripId: t.id });
        notify(`Déplacement: ${km(t.totalKm)} (${t.roundTrip ? 'aller-retour' : 'aller'})`);
      } else notify('Ajoute l’adresse de la job ou du client.', 'err');
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };

  /** Soumission en lignes de prix ou en devis détaillé (le choix devient le format par défaut). */
  const setFormat = async (format: 'lignes' | 'devis') => {
    if ((format === 'devis') === !!doc.devis) return;
    if (format === 'devis') {
      const devis = starterDevis();
      // Même montant pour le client: taxes incluses → le prix forfaitaire est l'ancien total (avant rabais)
      const inc = doc.taxIncluded ?? true;
      // Les lignes de prix deviennent le calcul du prix (pour toi) sous le devis
      const lines = doc.items.filter((it) => it.description.trim() && it.unitPrice);
      upd({
        devis, items: devisPriceItems(devis, inc ? round2(tot.total + tot.discount) : tot.lines), taxIncluded: inc,
        ...(lines.length && !doc.taxIncluded ? { estimate: { lines: lines.map((it) => ({ ...it })), note: 'Tes lignes de prix.' } } : {}),
        title: doc.title || devis.heading.replace(/^soumission\s+(de\s+|d[’']|pour\s+)?/i, '').replace(/^./, (c) => c.toUpperCase()),
      });
    } else {
      // Soumission en lignes: le calcul du prix (avant taxes) devient les lignes, sinon le prix reste sur une ligne
      const est = doc.estimate?.lines.length ? doc.estimate.lines : null;
      if (!(await ask({ title: 'Passer en lignes de prix?', message: est ? `Le texte du devis sera retiré. Les ${est.length} lignes du calcul du prix deviennent la soumission (prix avant taxes).` : 'Le texte du devis sera retiré. Le prix reste, sur une ligne.', confirm: 'Passer en lignes' }))) return;
      upd(est ? { devis: undefined, items: est.map((it) => ({ ...it })), taxIncluded: false } : { devis: undefined });
    }
    void saveSettings({ quoteFormat: format });
  };

  const emailBody = () => {
    if (L === 'en') {
      const hi = `${greeting('en')}${firstName(client) ? ` ${firstName(client)}` : ''},`;
      const tx = companyTexts(s, 'en');
      const lines = isInvoice
        ? [hi, '', `Please find attached invoice ${doc.number}${doc.title ? ` for “${doc.title}”` : ''}, for ${moneyFor(tot.balance, 'en')}.`, `Due date: ${dateFor(doc.dueDate, 'en')}.`, '', tx.paymentInstructions]
        : [hi, '', `As discussed, here is our quote ${doc.number}${doc.title ? ` for “${doc.title}”` : ''}, for ${moneyFor(tot.total, 'en')} (taxes included).`, `It is valid until ${dateFor(doc.dueDate, 'en')}.`, '', 'Feel free to contact me with any questions.'];
      return [...lines, '', `Thank you and have a great ${isEvening() ? 'evening' : 'day'}!`, '', s.emailSignature || s.companyName, s.phone].filter((x) => x !== undefined).join('\n');
    }
    const hello = `${greeting('fr')}${firstName(client) ? ` ${firstName(client)}` : ''},`;
    const lines = isInvoice
      ? [
          hello,
          '',
          `Vous trouverez ci-joint la facture ${doc.number}${doc.title ? ` pour « ${doc.title} »` : ''}, au montant de ${money(tot.balance)}.`,
          `Date d’échéance: ${formatDate(doc.dueDate)}.`,
          '',
          s.paymentInstructions,
        ]
      : [
          hello,
          '',
          `Tel que discuté, voici notre soumission ${doc.number}${doc.title ? ` pour « ${doc.title} »` : ''}, au montant de ${money(tot.total)} (taxes incluses).`,
          `Elle est valide jusqu’au ${formatDate(doc.dueDate)}.`,
          '',
          'N’hésitez pas à me contacter pour toute question.',
        ];
    return [...lines, '', `Merci et bonne ${isEvening() ? 'soirée' : 'journée'}!`, '', s.emailSignature || s.companyName, s.phone].filter((x) => x !== undefined).join('\n');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted"><Link className="back-link" to={isInvoice ? '/factures' : '/soumissions'}>← {isInvoice ? 'Factures' : 'Soumissions'}</Link></div>
          <h1>
            {kind} {doc.number || '(nouvelle)'} {doc.id && <span className={statusClass(doc)} style={{ verticalAlign: 'middle' }}>{statusLabel(doc)}</span>}
          </h1>
        </div>
      </div>

      {linked?.src && <div className="notice info">Créée à partir de la soumission <Link to={`/doc/${linked.src.id}`}>{linked.src.number}</Link>.</div>}
      {doc.signature && (
        <div className="notice ok row">
          <span>Acceptée en ligne par <strong>{doc.signature.name}</strong> le {new Date(doc.signature.at).toLocaleString('fr-CA')}{doc.type === 'quote' && !doc.convertedInvoiceId ? ' — crée la facture quand les travaux sont faits.' : ''}</span>
          {doc.type === 'quote' && !doc.convertedInvoiceId && <button className="btn small accent" onClick={() => void convertToInvoice()}>Créer la facture</button>}
        </div>
      )}
      {doc.review && (
        <div className={`notice ${doc.review.stars >= 4 ? 'ok' : 'err'}`}>
          Avis du client: <strong>{'★'.repeat(doc.review.stars)}{'☆'.repeat(5 - doc.review.stars)}</strong>{doc.review.toGoogle ? ' — redirigé vers Google' : ''}{doc.review.comment ? ` — « ${doc.review.comment} »` : ''}
        </div>
      )}
      <PortalStatus doc={doc} />
      {linked?.conv && <div className="notice ok">Convertie en facture <Link to={`/doc/${linked.conv.id}`}>{linked.conv.number}</Link>.</div>}

      <div className="card">
        <div className="form-grid">
          <div className="field full">
            Client *
            <ClientPicker value={doc.clientId} onChange={(id) => void db.clients.get(id).then((c) => setLangPatch(doc.lang ?? c?.lang ?? 'fr', { clientId: id }))} autoFocus={isNew && !doc.clientId && !doc.devis} />
          </div>
          <label className="field full">Description de la job (sert aussi de raison dans le journal de bord)
            <input value={doc.title} placeholder="ex.: Installation de céramique salle de bain" onChange={(e) => upd({ title: e.target.value })} />
          </label>
          {!isInvoice && (
            <>
              <label className="field">Date des travaux prévue (si elle est connue)<input type="date" value={doc.jobDate} onChange={(e) => upd({ jobDate: e.target.value })} /></label>
              <label className="field">Heure prévue<input type="time" value={doc.jobTime ?? ''} onChange={(e) => upd({ jobTime: e.target.value })} /></label>
            </>
          )}
          <label className="field full">
            Lieu des travaux
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <AddressInput value={doc.jobAddress} placeholder="ex.: 123 rue Principale, Laval, QC" onChange={(v) => upd({ jobAddress: v })} onPick={(label, geo) => { setDoc((d) => ({ ...d!, jobAddress: label, jobGeo: geo })); setSavedAddress(label); setDirty(true); }} />
              {client?.address && <button className="btn" onClick={() => { setDoc((d) => ({ ...d!, jobAddress: client.address, jobGeo: client.geo })); setSavedAddress(client.geo ? client.address : ''); setDirty(true); }} title="Adresse du client">= client</button>}
            </div>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head doc-format-head">
          <h2>{doc.devis ? 'Devis' : 'Détails'}</h2>
          {!isInvoice && (
            <div className="seg doc-format" role="tablist" aria-label="Format de la soumission">
              <button type="button" role="tab" aria-selected={!doc.devis} className={doc.devis ? '' : 'on'} onClick={() => void setFormat('lignes')}>Lignes de prix</button>
              <button type="button" role="tab" aria-selected={!!doc.devis} className={doc.devis ? 'on' : ''} onClick={() => void setFormat('devis')}>Devis détaillé</button>
            </div>
          )}
        </div>
        {doc.devis
          ? <DevisEditor doc={doc} onChange={upd} initialQuestions={questions} />
          : <LineItems items={doc.items} services={services} onChange={(items) => upd({ items })} lang={L} />}
        {!doc.devis && <div style={{ marginTop: 16 }}><TaxMode doc={doc} onChange={upd} /></div>}
        <div className="grid two" style={{ marginTop: 16, alignItems: 'start' }}>
          <details className="doc-extras" open={!isMobile || !!doc.discount || !!doc.deposit || !doc.applyTps !== !s.chargeTaxes}>
          <summary className="hide-desktop">Rabais, dépôt et taxes <small>{[doc.discount ? `rabais ${money(doc.discount)}` : '', doc.deposit ? `dépôt ${money(doc.deposit)}` : '', doc.applyTps || doc.applyTvq ? (doc.taxIncluded ? 'taxes comprises dans le prix' : 'taxes en plus') : 'sans taxes'].filter(Boolean).join(' · ')}</small></summary>
          <div className="form-grid">
            <label className="field">Rabais ($, avant taxes)<NumInput value={doc.discount} placeholder="0" onChange={(n) => upd({ discount: n })} /></label>
            <label className="field">Dépôt reçu ($)<NumInput value={doc.deposit} placeholder="0" onChange={(n) => upd({ deposit: n })} /></label>
            {(doc.deposit ?? 0) > 0 && (
              <div className="full">
                {doc.id
                  ? <ProofPhoto mediaId={doc.depositMediaId} link={{ docId: doc.id, clientId: doc.clientId }} label="Photo du dépôt (comptant / bordereau)" onChange={(id) => upd({ depositMediaId: id })} />
                  : <span className="small muted">Enregistre pour ajouter la photo du dépôt.</span>}
              </div>
            )}
            <label className="check"><input type="checkbox" checked={doc.applyTps} onChange={(e) => upd({ applyTps: e.target.checked })} /> TPS {s.tpsRate} %</label>
            <label className="check"><input type="checkbox" checked={doc.applyTvq} onChange={(e) => upd({ applyTvq: e.target.checked })} /> TVQ {s.tvqRate} %</label>
            {!doc.devis && (doc.applyTps || doc.applyTvq) && <label className="check full"><input type="checkbox" checked={!!doc.taxIncluded} onChange={(e) => upd({ taxIncluded: e.target.checked })} /> Prix taxes incluses (le total = les prix entrés)</label>}
          </div>
          </details>
          <div className="totals">
            {tot.discount > 0 && <div><span>Sous-total</span><span>{money(tot.lines)}</span></div>}
            {tot.discount > 0 && <div><span>Rabais</span><span>−{money(tot.discount)}</span></div>}
            {(tot.discount > 0 || doc.applyTps || doc.applyTvq) && <div><span>{tot.discount > 0 ? 'Après rabais' : 'Sous-total'}{doc.taxIncluded && (doc.applyTps || doc.applyTvq) ? ' (sans taxes)' : ''}</span><span>{money(tot.subtotal)}</span></div>}
            {doc.applyTps && <div><span>TPS{doc.taxIncluded ? ' incluse' : ''}</span><span>{money(tot.tps)}</span></div>}
            {doc.applyTvq && <div><span>TVQ{doc.taxIncluded ? ' incluse' : ''}</span><span>{money(tot.tvq)}</span></div>}
            <div className="grand"><span>Total{doc.taxIncluded ? ' (taxes incluses)' : ''}</span><span>{money(tot.total)}</span></div>
            {tot.deposit > 0 && <div><span>Dépôt reçu</span><span>−{money(tot.deposit)}</span></div>}
            {tot.paid - tot.deposit > 0 && <div><span>Paiements reçus</span><span>−{money(tot.paid - tot.deposit)}</span></div>}
            {tot.paid > 0 && <div className="grand"><span>Solde à payer</span><span>{money(tot.balance)}</span></div>}
          </div>
        </div>
        {!doc.devis && <details className="doc-extras" open={!isMobile}>
          <summary className="hide-desktop">Notes sur le PDF {doc.notes.trim() ? <small>{doc.notes.trim().slice(0, 40)}</small> : null}</summary>
          <label className="field" style={{ marginTop: 12 }}>Notes (apparaissent sur le PDF)<textarea value={doc.notes} onChange={(e) => upd({ notes: e.target.value })} /></label>
        </details>}
      </div>

      <details className="card more-opts" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
        <summary>
          <span><strong>Plus d’options</strong>
            <small>{formatDate(doc.date)} · {isInvoice ? (doc.dueDate === doc.date ? 'payable sur réception' : `échéance ${formatDate(doc.dueDate)}`) : `valide jusqu’au ${formatDate(doc.dueDate)}`} · {STATUS_LABELS[doc.status]}{doc.projectId ? ' · projet' : ''}</small>
          </span>
        </summary>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="field">Date<input type="date" value={doc.date} onChange={(e) => changeDate(e.target.value)} /></label>
          <label className="field">{isInvoice ? 'Échéance' : 'Valide jusqu’au'}<input type="date" value={doc.dueDate} onChange={(e) => upd({ dueDate: e.target.value })} /></label>
          <label className="field">Date des travaux<input type="date" value={doc.jobDate} onChange={(e) => upd({ jobDate: e.target.value })} /></label>
          <label className="field">Projet
            <select value={doc.projectId ?? ''} onChange={(e) => upd({ projectId: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">—</option>
              {projects.filter((p) => !doc.clientId || p.clientId === doc.clientId || p.id === doc.projectId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">Vendeur
            <select value={doc.salesRepId ?? ''} onChange={(e) => upd({ salesRepId: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">Moi</option>
              {members.filter((m) => m.active && (m.role === 'vendeur' || m.role === 'admin' || m.id === doc.salesRepId)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="field">Langue du document
            <select value={L} onChange={(e) => setLangPatch(e.target.value as 'fr' | 'en', { lang: e.target.value as 'fr' | 'en' })}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="field">
            Statut
            <select value={doc.status} onChange={(e) => {
              const status = e.target.value as DocStatus;
              // « Payée » à la main: on inscrit le paiement du solde (sinon l'encaissé du mois reste à 0)
              if (isInvoice && status === 'paid' && tot.balance > 0.004) upd({ status, payments: [...doc.payments, { date: todayISO(), amount: tot.balance, method: 'Non précisé', note: 'Marquée payée à la main' }] });
              else upd({ status });
            }}>
              {(isInvoice ? ['draft', 'sent', 'partial', 'paid', 'cancelled'] : ['draft', 'sent', 'accepted', 'refused', 'cancelled']).map((k) => (
                <option key={k} value={k}>{STATUS_LABELS[k as DocStatus]}</option>
              ))}
            </select>
          </label>
        </div>
      </details>

      {doc.id && isInvoice && <ProfitCard doc={doc} onChange={(p) => upd(p)} />}

      {doc.id ? (
        <>
          <MediaGallery link={{ docId: doc.id, jobId: doc.jobId, clientId: doc.clientId }} kinds={['avant', 'apres', 'job']} title="Photos des travaux" />
          <label className="check" style={{ margin: '-6px 0 16px 4px' }}>
            <input type="checkbox" checked={!!doc.pdfPhotos} onChange={(e) => { upd({ pdfPhotos: e.target.checked }); }} /> Joindre les photos avant/après au PDF
          </label>
        </>
      ) : null}

      <div className={`grid two ${doc.id ? '' : 'hide-mobile'}`}>
        <div className="card">
          <h2>Déplacement (journal de bord)</h2>
          {trip ? (
            <>
              <div><strong>{km(trip.totalKm)}</strong> {trip.roundTrip ? '(aller-retour)' : '(aller)'} — {trip.date}</div>
              <div className="small muted">De: {trip.fromLabel}<br />À: {trip.toLabel}<br />Raison: {trip.reason}</div>
              <div className="small muted">{METHOD_LABEL[trip.distanceMethod]}{trip.durationMin ? ` · ≈ ${trip.durationMin} min de route` : ''}</div>
              {s.googleMapsKey && <iframe className="map-embed" title="Trajet" loading="lazy" src={embedDirectionsUrl(s.googleMapsKey, trip.fromGeo ?? trip.fromLabel, trip.toGeo ?? trip.toLabel)} />}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={recalcTrip}><RefreshCw size={15} /> Recalculer</button>
                <a className="btn small" href={directionsLink(trip.fromGeo ?? trip.fromLabel, trip.toGeo ?? trip.toLabel)} target="_blank" rel="noreferrer"><Navigation size={15} /> Ouvrir dans Google Maps</a>
                <Link className="btn small" to="/km">Journal →</Link>
              </div>
            </>
          ) : (
            <>
              <div className="muted small">
                {doc.jobId
                  ? <>Compté dans la route de la journée du {doc.jobDate} (domicile → jobs → domicile). <Link to={`/agenda?d=${doc.jobDate}`}>Voir l’agenda</Link></>
                  : isInvoice && s.autoTripFromInvoices
                    ? 'Le trajet domicile → lieu des travaux sera ajouté automatiquement au journal de bord à l’enregistrement.'
                    : 'Aucun déplacement lié.'}
              </div>
              {!doc.jobId && <button className="btn small" style={{ marginTop: 8 }} onClick={recalcTrip}>+ Ajouter le déplacement maintenant</button>}
            </>
          )}
        </div>

        <div className="card">
          <h2>Actions</h2>
          <div className="row">
            {isInvoice && doc.id && doc.status !== 'paid' && <button className="btn accent" onClick={() => setShowPay(true)}><Banknote size={17} /> Enregistrer un paiement</button>}
            {!isInvoice && doc.id && !doc.convertedInvoiceId && <button className="btn accent" onClick={convertToInvoice}>Acceptée → créer la facture</button>}
            {!isInvoice && doc.id && doc.status !== 'refused' && !doc.convertedInvoiceId && <button className="btn" onClick={() => setStatus('refused')}>Refusée</button>}
            {isInvoice && doc.id && !doc.review && <ReviewRequestButton doc={doc} />}
            {doc.id && <button className="btn" onClick={duplicate}><Copy size={16} /> Dupliquer</button>}
            <button className="btn danger" onClick={remove}><Trash2 size={16} /> Supprimer</button>
          </div>
          {isInvoice && doc.payments.length > 0 && (
            <table className="list" style={{ marginTop: 12 }}>
              <tbody>
                {doc.payments.map((p, i) => (
                  <tr key={i}>
                    <td>{p.date}</td><td>{p.method}{p.note ? <div className="small muted">{p.note}</div> : null}</td>
                    <td><ProofPhoto mediaId={p.mediaId} link={{ docId: doc.id, clientId: doc.clientId }} label="Preuve" onChange={(mediaId) => save({ payments: doc.payments.map((x, j) => (j === i ? { ...x, mediaId } : x)) }, true)} /></td>
                    <td className="num">{money(p.amount)}</td>
                    <td><button className="btn small danger" onClick={() => { const payments = doc.payments.filter((_, j) => j !== i); const tt = docTotals({ ...doc, payments }, s); save({ payments, status: tt.paid <= 0 ? 'sent' : tt.balance > 0 ? 'partial' : 'paid' }); }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {emails.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3>Courriels envoyés</h3>
              {emails.map((e) => <div key={e.id} className="small">{new Date(e.date).toLocaleString('fr-CA')} → {e.to}</div>)}
            </div>
          )}
        </div>
      </div>


      <div className="doc-bar">
        <div className="db-total">
          <small>{doc.taxIncluded && (doc.applyTps || doc.applyTvq) ? 'Total (taxes incl.)' : 'Total'}</small>
          <b>{money(tot.total)}</b>
          <span className={`db-state ${dirty || !doc.id ? 'todo' : 'ok'}`}>{dirty || !doc.id ? 'À enregistrer' : <><Check size={13} /> Enregistré</>}</span>
        </div>
        <div className="db-actions">
          <button className={`btn ${dirty || !doc.id ? 'accent' : ''}`} onClick={() => void save()} disabled={busy}><Save size={17} /> {busy ? '…' : 'Enregistrer'}</button>
          <button className={`btn ${dirty || !doc.id ? '' : 'accent'}`} onClick={() => void sendText()} disabled={busy}><MessageSquare size={17} /> Texto</button>
          <button className="btn hide-mobile" onClick={openEmail}><Mail size={17} /> Courriel</button>
          {doc.id && <span className="hide-mobile"><PortalButton doc={doc} /></span>}
          <button className="btn icon-mobile" onClick={download} aria-label="Télécharger le PDF" title="Télécharger le PDF"><Download size={17} /> <span className="hide-mobile">PDF</span></button>
          <button className="btn icon-mobile" onClick={preview} aria-label="Aperçu" title="Aperçu (et toutes les façons d’envoyer)"><Eye size={17} /> <span className="hide-mobile">Aperçu</span></button>
        </div>
      </div>

      {askPhone && <ClientFormModal initial={askPhone} onClose={() => setAskPhone(null)} onSaved={() => { setAskPhone(null); void sendText(); }} />}
      {smsPc && <SmsFromComputer {...smsPc} onClose={() => setSmsPc(null)} />}

      {emailPdf && doc.id && (
        <SendEmailModal
          title={`Envoyer ${kind.toLowerCase()} ${doc.number}`}
          to={client?.email ?? ''}
          subject={`${L === 'en' ? (isInvoice ? 'Invoice' : 'Quote') : kind} ${doc.number} — ${s.companyName}`}
          body={emailBody()}
          attachments={[{ filename: docFileName(doc, client), mimeType: 'application/pdf', blob: emailPdf }]}
          onClose={() => setEmailPdf(null)}
          onSent={async ({ gmailId, to, subject }) => {
            await db.emails.add({ date: new Date().toISOString(), to, subject, clientId: doc.clientId, docId: doc.id, gmailId, kind: isInvoice ? 'facture' : 'soumission' });
            if (doc.status === 'draft') {
              await db.docs.update(doc.id!, { status: 'sent', sentAt: new Date().toISOString() });
              setDoc({ ...doc, status: 'sent', sentAt: new Date().toISOString() });
            }
          }}
        />
      )}

      {showPay && <PaymentModal balance={tot.balance} link={{ docId: doc.id, clientId: doc.clientId }} onClose={() => setShowPay(false)} onSave={(p) => {
        const payments = [...doc.payments, p];
        const tt = docTotals({ ...doc, payments }, s);
        save({ payments, status: tt.balance <= 0.004 ? 'paid' : 'partial' });
        if (tt.balance <= 0.004) celebrate();
        setShowPay(false);
      }} />}

      {readyView && (
        <ReadySheet
          doc={readyView.doc}
          blob={readyView.blob}
          saved={readyView.saved}
          kind={kind}
          clientName={client?.name ?? ''}
          phone={client?.phone}
          client={client}
          cardPay={!!(s.cardPayments && s.paymentsEndpoint)}
          total={docTotals(readyView.doc, s)}
          onClose={() => setReadyView(null)}
          onEmail={() => { setReadyView(null); void openEmail(); }}
          onShare={() => void share()}
          onDownload={() => downloadBlob(readyView.blob, docFileName(readyView.doc, client))}
          onPay={isInvoice && readyView.doc.status !== 'paid' ? () => { setReadyView(null); setShowPay(true); } : undefined}
          onInvoice={!isInvoice && !readyView.doc.convertedInvoiceId ? () => { setReadyView(null); void convertToInvoice(); } : undefined}
          questions={questions}
          onSent={() => { if (readyView.doc.status === 'draft') void save({ status: 'sent', sentAt: new Date().toISOString() }, true); }}
          smsText={(link) => clientDocMessage({ kind: readyView.doc.type, number: readyView.doc.number, amount: docTotals(readyView.doc, s).balance || docTotals(readyView.doc, s).total, client, company: s.companyName, owner: s.ownerName, lang: L, link: link || undefined, job: readyView.doc.title, address: readyView.doc.jobAddress || client?.address })}
        />
      )}
      {pdfUrl && (
        <Modal title="Aperçu" onClose={() => { URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }}>
          <iframe src={pdfUrl} title="Aperçu PDF" style={{ width: '100%', height: '70vh', border: 0 }} />
          <div className="small muted">Sur mobile, si l’aperçu ne s’affiche pas, utilise « ⬇ PDF ».</div>
        </Modal>
      )}
    </>
  );
}

export function PaymentModal({ balance, link, onClose, onSave }: { balance: number; link: { docId?: number; clientId?: number }; onClose: () => void; onSave: (p: Doc['payments'][number]) => void }) {
  const [amount, setAmount] = useState(balance);
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState('Virement Interac');
  const [mediaId, setMediaId] = useState<number>();
  const [note, setNote] = useState('');
  return (
    <Modal title="Enregistrer un paiement" onClose={onClose}>
      <div className="form-grid">
        <label className="field">Montant<NumInput value={amount} onChange={(n) => setAmount(n)} /></label>
        <label className="field">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field full">Mode
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['Virement Interac', 'Comptant', 'Chèque', 'Dépôt au comptoir', 'Carte de crédit', 'Dépôt direct', 'Autre'].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="field full">Note (optionnel)<input value={note} placeholder="ex.: payé en argent sur place" onChange={(e) => setNote(e.target.value)} /></label>
        <div className="full">
          <div className="small muted" style={{ marginBottom: 6 }}>
            {method === 'Comptant' || method === 'Chèque' || method === 'Dépôt au comptoir' ? 'Prends en photo l’argent, le chèque ou le bordereau de dépôt (preuve pour le comptable).' : 'Photo de preuve (optionnel)'}
          </div>
          <ProofPhoto mediaId={mediaId} link={link} label="Prendre la photo" onChange={setMediaId} />
        </div>
      </div>
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn accent" onClick={() => amount > 0 && onSave({ amount: round2(amount), date, method, mediaId, note: note || undefined })}>Enregistrer</button>
      </div>
    </Modal>
  );
}

function PortalButton({ doc }: { doc: Doc }) {
  const notify = useToast();
  const st = useSyncState();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const client = useLiveQuery(() => db.clients.get(doc.clientId), [doc.clientId]);
  const kind = doc.type === 'invoice' ? 'facture' : 'soumission';
  const s = useSettings();
  const tt = docTotals(doc, s);
  const msg = (link?: string) => clientDocMessage({ kind: doc.type, number: doc.number, amount: tt.balance || tt.total, client, company: s.companyName, owner: s.ownerName, lang: docLangOf(doc, client), link, job: doc.title, address: doc.jobAddress || client?.address });
  const [text, setText] = useState('');
  const [pc, setPc] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const l = await publishPortal(doc.id!);
      setText(msg(l));
      setLink(l);
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn" onClick={open} disabled={busy || st.status === 'off'} title={st.status === 'off' ? 'Active la synchronisation pour utiliser le lien client' : 'Lien à envoyer au client'}>
        <Link2 size={17} /> {busy ? '…' : 'Lien client'}
      </button>
      {link && (
        <Modal title={`Envoyer ${doc.type === 'quote' ? 'la soumission' : 'la facture'} — ${doc.number}`} onClose={() => setLink(null)}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Le message part avec le lien: le client voit sa {kind}{doc.type === 'quote' ? ', l’accepte et la signe en ligne' : ' et comment payer'}. Aucun compte requis.
          </p>
          <label className="field">Message au client (tu peux le changer)
            <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="link-send">
            {client?.phone
              ? canTextHere()
                ? <a className="btn accent" href={smsLink(client.phone, text)}><MessageSquare size={16} /> Envoyer par texto</a>
                : <button className="btn accent" onClick={() => setPc(true)}><MessageSquare size={16} /> Envoyer par texto</button>
              : <span className="small muted">Ajoute le cellulaire du client (fiche du client) pour envoyer par texto.</span>}
            <a className="btn" href={`mailto:${client?.email ?? ''}?subject=${encodeURIComponent(`${kind[0].toUpperCase()}${kind.slice(1)} ${doc.number} — ${s.companyName}`)}&body=${encodeURIComponent(text)}`}><Mail size={16} /> Courriel</a>
            {(isNative() || !!navigator.share) && <button className="btn" onClick={() => void shareLink(`${doc.number}`, text, '')}><Share2 size={16} /> Partager (Messenger…)</button>}
            <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(text); notify('Message copié: colle-le où tu veux'); } catch { notify('Sélectionne et copie le message.', 'err'); } }}><Copy size={16} /> Copier le message</button>
          </div>
          <details className="link-only">
            <summary className="small muted">Juste le lien</summary>
            <div className="row" style={{ flexWrap: 'nowrap', marginTop: 6 }}>
              <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Lien client" />
              <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(link); notify('Lien copié'); } catch { notify('Sélectionne et copie le lien.', 'err'); } }} aria-label="Copier le lien"><Copy size={16} /></button>
            </div>
          </details>
          {doc.viewedAt && <div className="notice info" style={{ marginTop: 12 }}>Vu par le client le {new Date(doc.viewedAt).toLocaleString('fr-CA')}</div>}
          {doc.signature && <div className="notice ok">Acceptée et signée par {doc.signature.name} le {new Date(doc.signature.at).toLocaleString('fr-CA')}</div>}
        </Modal>
      )}
      {pc && client?.phone && <SmsFromComputer phone={client.phone} text={text} name={client.name} onClose={() => setPc(false)} />}
    </>
  );
}

function ProfitCard({ doc, onChange }: { doc: Doc; onChange: (p: Partial<Doc>) => void }) {
  const nav = useNavigate();
  const p = useLiveQuery(() => profitOfDoc(doc.id!), [doc.id, doc._u]);
  const receipts = useLiveQuery(() => db.expenses.where('docId').equals(doc.id!).toArray(), [doc.id]) ?? [];
  return (
    <div className="card">
      <div className="card-head">
        <TrendingUp size={18} /><h2>Rentabilité de la job</h2><span className="spacer" />
        {p && <span className={`badge ${p.margin >= 50 ? 'green' : p.margin >= 25 ? 'amber' : 'red'}`}>marge {p.margin} %</span>}
      </div>
      <div className="grid two" style={{ alignItems: 'start' }}>
        <div className="form-grid">
          <label className="field">Heures travaillées<NumInput value={doc.hoursWorked} placeholder="0" onChange={(n) => onChange({ hoursWorked: n || undefined })} /></label>
          <label className="field">Autres coûts ($)<NumInput value={doc.otherCost} placeholder="sous-traitant…" onChange={(n) => onChange({ otherCost: n || undefined })} /></label>
          <div className="full">
            <div className="small muted" style={{ marginBottom: 6 }}>Reçus liés à cette job ({receipts.length})</div>
            {receipts.map((r) => <div key={r.id} className="small"><Link to={`/depenses/${r.id}`}>{r.date} — {r.vendor || r.category}</Link> · {money(r.subtotal)}</div>)}
            <button className="btn small" style={{ marginTop: 6 }} onClick={() => nav(`/depenses/new?doc=${doc.id}`)}><Plus size={14} /> Ajouter un reçu de matériaux</button>
          </div>
        </div>
        {p && (
          <div className="totals">
            <div><span>Revenu (avant taxes)</span><span>{money(p.revenue)}</span></div>
            <div><span>Matériaux</span><span>−{money(p.materials)}</span></div>
            <div><span>Km ({p.km} km)</span><span>−{money(p.kmCost)}</span></div>
            {p.labor > 0 && <div><span>Main-d’œuvre</span><span>−{money(p.labor)}</span></div>}
            {p.other > 0 && <div><span>Autres coûts</span><span>−{money(p.other)}</span></div>}
            <div className="grand"><span>Profit</span><span>{money(p.profit)}</span></div>
            {p.perHour !== undefined && <div className="small muted"><span>Ton taux horaire réel</span><span>{money(p.perHour)}/h</span></div>}
          </div>
        )}
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>Enregistre la facture pour mettre le calcul à jour.</div>
    </div>
  );
}

function ReviewRequestButton({ doc }: { doc: Doc }) {
  const notify = useToast();
  const st = useSyncState();
  const [link, setLink] = useState<string | null>(null);
  const client = useLiveQuery(() => db.clients.get(doc.clientId), [doc.clientId]);
  const s = useSettings();
  const open = async () => {
    try {
      setLink(reviewLink(await publishPortal(doc.id!)));
      await db.docs.update(doc.id!, { reviewRequestedAt: new Date().toISOString() });
    } catch (e) {
      notify(errMsg(e), 'err');
    }
  };
  const text = docLangOf(doc, client) === 'en'
    ? `Hello ${client?.contact || client?.name || ''}, thank you for choosing ${s.companyName}! Could you take 30 seconds to tell us how we did?`
    : `Bonjour ${client?.contact || client?.name || ''}, merci d’avoir fait affaire avec ${s.companyName}! Pourriez-vous prendre 30 secondes pour nous donner votre avis?`;
  return (
    <>
      <button className="btn" disabled={st.status === 'off'} title={st.status === 'off' ? 'Active la synchronisation' : 'Demander un avis au client'} onClick={open}><Star size={16} /> Demander un avis</button>
      {link && (
        <Modal title="Demander un avis" onClose={() => setLink(null)}>
          <p style={{ marginTop: 0 }}>{text}</p>
          <div className="row" style={{ flexWrap: 'nowrap' }}><input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Lien d’avis" /></div>
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            {client?.phone && <a className="btn" href={smsLink(client.phone, `${text} ${link}`)}>Texto</a>}
            <a className="btn" href={`mailto:${client?.email ?? ''}?subject=${encodeURIComponent(`Votre avis — ${s.companyName}`)}&body=${encodeURIComponent(`${text}\n${link}`)}`}>Courriel</a>
            <button className="btn accent" onClick={() => void shareLink('Votre avis', text, link)}><Share2 size={16} /> Partager</button>
          </div>
          {!s.googleReviewUrl && <div className="notice" style={{ marginTop: 10 }}>Ajoute le lien de ta fiche Google dans Paramètres → Avis clients pour que les 5 étoiles aillent sur Google.</div>}
        </Modal>
      )}
    </>
  );
}

/** Juste après « Enregistrer »: la facture en PDF, prête à envoyer en un geste. */
function ReadySheet({ doc, blob, saved, kind, clientName, phone, client, cardPay, total, onClose, onEmail, onShare, onDownload, onPay, onInvoice, questions = [], onSent, smsText }: {
  doc: Doc; blob: Blob; saved: boolean; kind: string; clientName: string; phone?: string; client?: Client; cardPay: boolean; total: { total: number; balance: number };
  onClose: () => void; onEmail: () => void; onShare: () => void; onDownload: () => void; onPay?: () => void; onInvoice?: () => void; questions?: string[]; onSent: () => void; smsText: (link: string) => string;
}) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  // Le message du texto, personnalisé pour ce client et modifiable avant l'envoi (le lien s'ajoute tout seul)
  const [custom, setCustom] = useState(() => smsText(''));
  const text = async () => {
    if (!phone) return;
    setBusy(true);
    let link = '';
    try {
      link = await publishPortal(doc.id!);
    } catch {
      notify('Envoyé sans lien en ligne (active la synchronisation pour que le client puisse voir et payer en ligne).', 'err');
    }
    onSent();
    setBusy(false);
    const typed = custom.trim();
    const body = typed === smsText('').trim() ? smsText(link) : `${typed}${link ? `\n${link}` : ''}`;
    if (canTextHere()) window.location.href = smsLink(phone, body);
    else setPcText(body);
  };
  const [pcText, setPcText] = useState<string | null>(null);
  const [editClient, setEditClient] = useState(false);
  const isQuote = doc.type === 'quote';
  const lines = doc.items.filter((it) => it.description.trim() || it.code || it.unitPrice).length;
  const what = doc.devis ? doc.devis.heading || 'Devis détaillé' : `${lines} ligne${lines > 1 ? 's' : ''}`;
  const address = doc.jobAddress || client?.address || '';
  const missing = [!client?.email && 'courriel', !client?.phone && 'cellulaire'].filter(Boolean) as string[];
  return (
    <Modal title={clientName ? `Envoyer ${isQuote ? 'la soumission' : 'la facture'} à ${clientName}` : `${kind} ${doc.number}`} onClose={onClose}>
      <div className="ready-head">
        {saved && <CircleCheck size={22} />}
        <div>
          <strong>{saved ? `${kind} ${doc.number} enregistrée` : `${kind} ${doc.number}`}</strong>
          <small>{doc.status === 'paid' ? 'Payée' : doc.status === 'draft' ? 'Pas encore envoyée' : doc.sentAt ? `Envoyée le ${new Date(doc.sentAt).toLocaleDateString('fr-CA')}` : ''}</small>
        </div>
      </div>
      {client && missing.length > 0 && (
        <div className="send-warn">
          <TriangleAlert size={18} />
          <span>Ce client n’a pas de {missing.join(' ni de ')}.{!client.email && isQuote ? ' Il pourra quand même signer avec le lien envoyé par texto.' : ''}</span>
          <button className="btn small" onClick={() => setEditClient(true)}><Pencil size={14} /> Modifier le client</button>
        </div>
      )}
      <div className="send-sum">
        <div className="send-sum-title">Résumé {isQuote ? 'de la soumission' : 'de la facture'}</div>
        {questions.length > 0 && <div className="send-questions"><b>À demander au client</b><ul>{questions.map((q) => <li key={q}>{q}</li>)}</ul></div>}
        {address && <div><span>Adresse</span><b>{address}</b></div>}
        <div><span>{doc.devis ? 'Devis' : 'Services'}</span><b>{what}</b></div>
        {doc.deposit ? <div><span>Dépôt reçu</span><b>{money(doc.deposit)}</b></div> : null}
        <div className="tot"><span>{total.balance > 0 && total.balance < total.total ? 'Solde' : 'Total'}</span><b>{money(total.balance > 0 && total.balance < total.total ? total.balance : total.total)}</b></div>
        <div className="send-feats">
          {isQuote && <span><Check size={14} /> Le client peut accepter et signer en ligne</span>}
          {cardPay ? <span><Check size={14} /> Paiement par carte dans le lien</span> : <span className="muted"><CreditCard size={14} /> Paiement par carte: à activer dans Paramètres</span>}
        </div>
      </div>
      {phone && (
        <label className="field ready-msg">Message du texto (tu peux le changer)
          <textarea rows={4} value={custom} onChange={(e) => setCustom(e.target.value)} />
          <small className="muted">Le lien vers {isQuote ? 'la soumission' : 'la facture'} est ajouté tout seul.</small>
        </label>
      )}
      <div className="ready-actions">
        {phone && <button className="btn accent" disabled={busy} onClick={() => void text()}><MessageSquare size={17} /> Texto au client</button>}
        <button className={`btn ${phone ? '' : 'accent'}`} onClick={onEmail}><Mail size={17} /> Courriel</button>
        <PortalButton doc={doc} />
        <button className="btn" onClick={onShare}><Share2 size={17} /> Partager</button>
        <button className="btn" onClick={onDownload}><Download size={17} /> Télécharger</button>
        {onPay && <button className="btn" onClick={onPay}><Banknote size={17} /> Payée</button>}
        {onInvoice && <button className="btn" onClick={onInvoice}><FileText size={17} /> Créer la facture</button>}
      </div>
      <PdfView blob={blob} />
      <button className="btn block" style={{ marginTop: 12 }} onClick={onClose}>Continuer à modifier</button>
      {editClient && client && <ClientFormModal initial={client} onClose={() => setEditClient(false)} onSaved={() => setEditClient(false)} />}
      {pcText !== null && phone && <SmsFromComputer phone={phone} text={pcText} name={clientName} onClose={() => setPcText(null)} />}
    </Modal>
  );
}
