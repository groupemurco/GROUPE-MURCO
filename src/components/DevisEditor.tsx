import { ArrowDown, ArrowUp, BookmarkPlus, Calculator, CircleHelp, Mic, Plus, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { db, saveSettings, type Doc, type LineItem, type Settings } from '../lib/db';
import {
  blankDevis, contactFromText, DEVIS_TEMPLATES, devisFromTemplate, devisFromText, devisLineDescription, devisTitle, estimateTotal, isDevisEmpty, priceFromEstimate,
  sectionTotalText, templateKeyFor, type Devis, type DevisDraft, type DevisEstimate, type DevisSection,
} from '../lib/devis';
import { useSettings } from '../lib/hooks';
import { listen, speechSupported, type Listening } from '../lib/speech';
import { activeTrades } from '../lib/orders';
import { tradeOf } from '../lib/templates';
import { docTotals, lineAmount, money, round2 } from '../lib/utils';
import { Modal } from './Modal';
import { NumInput } from './NumInput';
import { errMsg, useConfirm, useToast } from './Toast';

/** La ligne de prix unique d'un devis (le montant sert aux totaux, à la facture et aux rapports). */
export function devisPriceItems(d: Devis, price: number): LineItem[] {
  return [{ code: '', description: devisLineDescription(d), unit: 'forfait', quantity: 1, unitPrice: round2(price) }];
}

/** Devis neuf: vide (l'assistant l'écrit selon la demande du client). */
export const starterDevis = () => blankDevis();

/** Modèle dont l'assistant imite le style: le dernier enregistré par l'entrepreneur, sinon celui de son métier. */
function styleDevis(s: Settings): Devis {
  const own = s.devisTemplates ?? [];
  return own.length ? own[own.length - 1].devis : devisFromTemplate(templateKeyFor(activeTrades(s)));
}

/** Courriel envoyé depuis la page Gmail (« Faire un devis »), repris une seule fois par la boîte de l'assistant. */
export const DEVIS_MAIL_KEY = 'murco.devisMail';
function takeMail(): string {
  try {
    const t = sessionStorage.getItem(DEVIS_MAIL_KEY) ?? '';
    sessionStorage.removeItem(DEVIS_MAIL_KEY);
    return t;
  } catch {
    return '';
  }
}

const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const digits = (x?: string) => (x ?? '').replace(/\D/g, '').slice(-10);

const docPrice = (doc: Pick<Doc, 'items'>) => round2(doc.items.reduce((a, it) => a + lineAmount(it), 0));

/** Soumission rédigée: ouvrages visés, travaux inclus, prix forfaitaire, conditions et signature. */
export function DevisEditor({ doc, onChange }: { doc: Doc; onChange: (patch: Partial<Doc>) => void }) {
  const s = useSettings();
  const notify = useToast();
  const ask = useConfirm();
  const d = doc.devis!;
  const price = docPrice(doc);
  const tot = docTotals(doc, s);
  const [saving, setSaving] = useState<string | null>(null);
  const [mail] = useState(takeMail);
  const [aiOpen, setAiOpen] = useState(() => !!mail || isDevisEmpty(d));
  const [questions, setQuestions] = useState<string[]>([]);
  const saved = s.devisTemplates ?? [];

  /** Résultat de l'assistant: devis, prix, adresse; le client est retrouvé (courriel, cell, nom) ou créé. */
  const applyDraft = async (r: DevisDraft, text: string, failed?: string) => {
    // Prix: celui qui est dit, sinon l'estimation de l'assistant avec tes prix, sinon on garde le prix actuel
    const taxIncluded = r.taxIncluded ?? doc.taxIncluded;
    const est = r.estimate ? estimateTotal(r.estimate.lines) : 0;
    const guessed = !r.price && est > 0 ? priceFromEstimate(est, { taxIncluded, taxed: doc.applyTps || doc.applyTvq, tpsRate: s.tpsRate, tvqRate: s.tvqRate }) : 0;
    const patch: Partial<Doc> = { devis: r.devis, items: devisPriceItems(r.devis, r.price ?? (guessed || price)) };
    if (r.estimate) patch.estimate = r.estimate;
    if (r.taxIncluded !== undefined) patch.taxIncluded = r.taxIncluded;
    if (r.address && !doc.jobAddress) patch.jobAddress = r.address;
    const what = r.devis.heading.replace(/^soumission\s+(de\s+|d[’']|pour\s+)?/i, '').trim();
    if (!doc.title.trim() && what) patch.title = what.charAt(0).toUpperCase() + what.slice(1);
    let clientId = doc.clientId;
    let who = '';
    const c = r.client;
    if (!clientId && c && (c.name || c.email || c.phone)) {
      const all = await db.clients.toArray();
      const found = all.find((x) => c.email && x.email.toLowerCase() === c.email)
        ?? all.find((x) => c.phone && digits(x.phone).length === 10 && digits(x.phone) === digits(c.phone))
        ?? all.find((x) => c.name && norm(x.name) === norm(c.name));
      if (found) {
        clientId = found.id!;
        // On complète la fiche avec ce qui manquait
        const fill = { email: found.email || c.email || '', phone: found.phone || c.phone || '', address: found.address || c.address || '' };
        if (fill.email !== found.email || fill.phone !== found.phone || fill.address !== found.address) await db.clients.update(clientId, fill);
        who = `Client: ${found.name}.`;
      } else {
        const name = c.name || c.contact || c.email || 'Nouveau client';
        clientId = await db.clients.add({ name, contact: c.contact ?? '', email: c.email ?? '', phone: c.phone ?? '', address: c.address || r.address || '', notes: '', createdAt: new Date().toISOString() });
        who = `Nouveau client ajouté: ${name}.`;
      }
      patch.clientId = clientId;
    } else if (!clientId) who = 'Choisis le client en haut.';
    // Le courriel du client est gardé dans sa conversation
    const body = text.trim().slice(0, 8000);
    if (r.fromClient && clientId && !(await db.messages.where('clientId').equals(clientId).filter((m) => m.text === body).count())) {
      await db.messages.add({ clientId, dir: 'in', channel: 'courriel', text: body, at: new Date().toISOString() });
    }
    onChange(patch);
    setQuestions(r.questions ?? []);
    if (failed) return notify(`${failed} ${who}`.trim(), 'err');
    setAiOpen(false);
    notify(`Devis écrit. ${who}${guessed ? ` Prix approximatif: ${money(guessed)} (calculé avec tes prix) — change-le si y’a de quoi.` : who ? '' : 'Relis-le, mets ton prix, puis envoie.'}`.trim());
  };

  const set = (patch: Partial<Devis>) => {
    const next = { ...d, ...patch };
    onChange({ devis: next, items: devisPriceItems(next, price) });
  };
  const setSection = (i: number, patch: Partial<DevisSection>) => set({ sections: d.sections.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, by: number) => {
    const list = [...d.sections];
    const [x] = list.splice(i, 1);
    list.splice(i + by, 0, x);
    set({ sections: list });
  };

  const pickTemplate = async (key: string) => {
    if (!key) return;
    const label = key.startsWith('perso:') ? key.slice(6) : DEVIS_TEMPLATES.find((x) => x.key === key)?.label;
    if (!(await ask({ title: `Prendre le modèle « ${label} »?`, message: 'Le texte du devis sera remplacé. Le prix, le client et l’adresse restent.', confirm: 'Remplacer' }))) return;
    const next = devisFromTemplate(key, saved);
    onChange({ devis: next, items: devisPriceItems(next, price) });
  };

  const saveTemplate = async (name: string) => {
    const n = name.trim();
    if (!n) return notify('Donne un nom au modèle.', 'err');
    await saveSettings({ devisTemplates: [...saved.filter((x) => x.name !== n), { name: n, devis: d }] });
    setSaving(null);
    notify(`Modèle « ${n} » enregistré: il sera dans la liste des modèles.`);
  };

  return (
    <div className="devis-ed">
      {aiOpen && <DevisAi doc={doc} initial={mail} canClose={!isDevisEmpty(d)} onClose={() => setAiOpen(false)} onDone={applyDraft} />}
      <div className="dv-tools">
        <select className="dv-tpl" value="" onChange={(e) => void pickTemplate(e.target.value)} aria-label="Modèle de devis">
          <option value="">Partir d’un modèle…</option>
          {saved.length > 0 && <optgroup label="Mes modèles">{saved.map((x) => <option key={x.name} value={`perso:${x.name}`}>{x.name}</option>)}</optgroup>}
          <optgroup label="Modèles par métier">{DEVIS_TEMPLATES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
        </select>
        {!aiOpen && <button type="button" className="btn small accent" onClick={() => setAiOpen(true)}><Sparkles size={15} /> Assistant</button>}
        <button type="button" className="btn small" onClick={() => setSaving(d.heading.replace(/^soumission\s+(de\s+|d[’']|pour\s+)?/i, '').replace(/^./, (c) => c.toUpperCase()))}><BookmarkPlus size={15} /> Enregistrer comme modèle</button>
      </div>

      {questions.length > 0 && (
        <div className="dv-questions">
          <CircleHelp size={18} />
          <div><b>À demander au client</b><ul>{questions.map((q) => <li key={q}>{q}</li>)}</ul></div>
          <button type="button" className="btn icon-btn small" onClick={() => setQuestions([])} aria-label="Fermer"><X size={15} /></button>
        </div>
      )}

      <label className="field">Titre du devis
        <input value={d.heading} placeholder="ex.: Soumission de calfeutrage" onChange={(e) => set({ heading: e.target.value })} />
        <small className="dv-preview">{devisTitle(s.companyName, d)}</small>
      </label>

      {d.sections.map((sec, i) => (
        <div className="dv-sec" key={i}>
          <div className="dv-sec-head">
            <input className="dv-sec-title" value={sec.title} placeholder="Titre de la section (ex.: Ouvertures visées)" aria-label="Titre de la section" onChange={(e) => setSection(i, { title: e.target.value })} />
            <button type="button" className="btn icon-btn small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter"><ArrowUp size={15} /></button>
            <button type="button" className="btn icon-btn small" disabled={i === d.sections.length - 1} onClick={() => move(i, 1)} aria-label="Descendre"><ArrowDown size={15} /></button>
            <button type="button" className="btn icon-btn small danger" onClick={() => set({ sections: d.sections.filter((_, j) => j !== i) })} aria-label="Retirer la section"><Trash2 size={15} /></button>
          </div>
          <textarea rows={Math.min(9, Math.max(3, sec.items.length + 1))} value={sec.items.join('\n')} placeholder={'Un point par ligne\nex.: 5 fenêtres au sous-sol'} aria-label={`Points de ${sec.title || 'la section'}`}
            onChange={(e) => setSection(i, { items: e.target.value.split('\n') })} />
          <div className="dv-count">
            <label className="check"><input type="checkbox" checked={sec.countLabel !== undefined} onChange={(e) => setSection(i, { countLabel: e.target.checked ? 'éléments' : undefined })} /> Calculer le total</label>
            {sec.countLabel !== undefined && <input value={sec.countLabel} placeholder="ouvertures" aria-label="Mot du total" onChange={(e) => setSection(i, { countLabel: e.target.value })} />}
            {sectionTotalText(sec) && <b>{sectionTotalText(sec)}</b>}
          </div>
        </div>
      ))}
      <button type="button" className="btn small dv-add" onClick={() => set({ sections: [...d.sections, { title: '', items: [] }] })}><Plus size={15} /> Ajouter une section</button>

      <div className="dv-price">
        <input className="dv-price-label" value={d.priceLabel} aria-label="Libellé du prix" onChange={(e) => set({ priceLabel: e.target.value })} />
        <div className="dv-price-row">
          <NumInput value={price} placeholder="0" aria-label="Prix" onChange={(n) => onChange({ items: devisPriceItems(d, n) })} />
          <span>$</span>
          <label className="check"><input type="checkbox" checked={!!doc.taxIncluded} onChange={(e) => onChange({ taxIncluded: e.target.checked })} /> Taxes incluses</label>
        </div>
        <div className="small muted">
          {doc.applyTps || doc.applyTvq
            ? doc.taxIncluded
              ? `Le client paie ${money(tot.total)} (dont TPS ${money(tot.tps)} et TVQ ${money(tot.tvq)}).`
              : `Le client paie ${money(tot.total)} avec les taxes (TPS ${money(tot.tps)}, TVQ ${money(tot.tvq)}).`
            : `Le client paie ${money(tot.total)}${doc.taxIncluded ? ' — « taxes incluses » est écrit sur le devis.' : ' (aucune taxe ajoutée).'}`}
        </div>
      </div>

      {doc.estimate && doc.estimate.lines.length > 0 && <EstimatePanel doc={doc} estimate={doc.estimate} onChange={onChange} />}

      <label className="field">Note sous le prix
        <input value={d.priceNote} placeholder="ex.: La couleur du scellant sera déterminée avec vous avant les travaux." onChange={(e) => set({ priceNote: e.target.value })} />
      </label>
      <label className="field">Conditions (une par ligne)
        <textarea rows={Math.min(8, Math.max(3, d.conditions.length + 1))} value={d.conditions.join('\n')} onChange={(e) => set({ conditions: e.target.value.split('\n') })} />
      </label>
      <label className="field">Mot de la fin
        <textarea rows={2} value={d.closing} onChange={(e) => set({ closing: e.target.value })} />
      </label>
      <div className="dv-sign">
        <div className="small muted">Signé au bas du devis</div>
        <b>{s.ownerName || 'Ton nom (Paramètres)'}</b>
        <span>{s.companyName}</span>
        <input value={s.tagline ?? ''} placeholder="Tes métiers (ex.: Calfeutrage • Aluminium)" aria-label="Métiers sous la signature" onChange={(e) => void saveSettings({ tagline: e.target.value })} />
        <span className="small muted">{[s.email, s.website].filter(Boolean).join(' · ') || 'Courriel et site web: Paramètres'}</span>
      </div>

      {saving !== null && (
        <Modal title="Enregistrer comme modèle" onClose={() => setSaving(null)}>
          <p className="small muted" style={{ marginTop: 0 }}>Le texte de ce devis (sans le prix ni le client) sera offert dans « Partir d’un modèle ».</p>
          <label className="field">Nom du modèle<input autoFocus value={saving} onChange={(e) => setSaving(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveTemplate(saving); }} /></label>
          {saved.length > 0 && (
            <div className="dv-saved">
              <div className="small muted">Mes modèles</div>
              {saved.map((x) => (
                <div key={x.name} className="row"><span>{x.name}</span><span className="spacer" />
                  <button type="button" className="btn small danger" onClick={() => void saveSettings({ devisTemplates: saved.filter((y) => y.name !== x.name) })} aria-label={`Supprimer ${x.name}`}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setSaving(null)}>Annuler</button>
            <button type="button" className="btn accent" onClick={() => void saveTemplate(saving)}>Enregistrer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Boîte de l'assistant: on colle le courriel du client (ou on dit quoi faire) et il écrit le devis. */
function DevisAi({ doc, initial, canClose, onClose, onDone }: { doc: Doc; initial: string; canClose: boolean; onClose: () => void; onDone: (r: DevisDraft, text: string, failed?: string) => Promise<void> }) {
  const s = useSettings();
  const notify = useToast();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [hearing, setHearing] = useState(false);
  const rec = useRef<Listening | null>(null);
  const current = doc.devis && !isDevisEmpty(doc.devis) ? doc.devis : undefined;
  useEffect(() => () => rec.current?.stop(), []);

  const mic = () => {
    if (rec.current) return rec.current.stop();
    const before = text.trim();
    rec.current = listen(
      (t) => setText(before ? `${before} ${t}` : t),
      (err, t) => {
        rec.current = null;
        setHearing(false);
        if (t?.trim()) setText(before ? `${before} ${t.trim()}` : t.trim());
        else if (err) notify(err, 'err');
      },
    );
    if (rec.current) setHearing(true);
    else notify('La dictée n’est pas disponible ici: écris ou colle le texte.', 'err');
  };

  const go = async () => {
    const t = text.trim();
    if (t.length < 4) return notify('Colle le courriel du client ou dis ce qu’il faut faire.', 'err');
    rec.current?.stop();
    setBusy(true);
    let r: DevisDraft;
    let failed: string | undefined;
    try {
      const { aiDevis } = await import('../lib/ai');
      const trades = activeTrades(s).map((k) => tradeOf(k)?.label).filter(Boolean).join(', ');
      const known = doc.clientId ? (await db.clients.get(doc.clientId))?.name : undefined;
      const prices = (await db.services.orderBy('order').toArray()).map((x) => ({ code: x.code, name: x.name, unit: x.unit, price: x.price, minimum: x.minimum }));
      r = await aiDevis({ company: s.companyName, owner: s.ownerName, trades, text: t, style: styleDevis(s), current, clientKnown: known, prices, model: s.aiModel || undefined });
    } catch (e) {
      // Sans l'assistant: un courriel → on reprend au moins les coordonnées; une phrase → chaque morceau devient un point
      const isMail = /@|\n.*\n/.test(t) && t.length > 120;
      r = isMail
        ? { devis: current ?? doc.devis ?? blankDevis(), client: contactFromText(t, { email: s.email, phone: s.phone }), fromClient: true }
        : devisFromText(t, current ?? styleDevis(s));
      const why = `L’assistant n’a pas répondu (${errMsg(e).slice(0, 70)}).`;
      if (isMail) failed = `${why} J’ai repris les coordonnées du client: réessaie dans un moment ou écris le devis.`;
      else notify(`${why} Fait sans lui: vérifie le texte.`, 'err');
    }
    try {
      await onDone(r, t, failed);
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dv-ai">
      <div className="dv-ai-head">
        <Sparkles size={18} />
        <b>{current ? 'Que faut-il changer?' : 'Colle le courriel du client ou dis ce qu’il faut faire'}</b>
        {canClose && <button type="button" className="btn icon-btn small" onClick={onClose} aria-label="Fermer"><X size={15} /></button>}
      </div>
      <textarea rows={initial ? 8 : 5} value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
        placeholder={current
          ? 'ex.: ajoute la porte de garage, mets 1 850 $ taxes incluses'
          : 'Colle ici le courriel reçu (avec le nom, le téléphone et l’adresse), ou écris: « calfeutrage de 12 fenêtres et la porte-patio, 1 650 $ taxes incluses »'} />
      <div className="dv-ai-actions">
        {speechSupported() && <button type="button" className={`btn ${hearing ? 'danger' : ''}`} onClick={mic} disabled={busy}>{hearing ? <><Square size={15} /> Arrêter</> : <><Mic size={16} /> Dicter</>}</button>}
        <span className="spacer" />
        <button type="button" className="btn accent" disabled={busy} onClick={() => void go()}><Sparkles size={16} /> {busy ? 'L’assistant écrit…' : current ? 'Modifier le devis' : 'Écrire le devis'}</button>
      </div>
      <div className="small muted">L’assistant trouve le client (ou l’ajoute), l’adresse et les travaux. Rien n’est envoyé: tu relis avant.</div>
    </div>
  );
}

/** Calcul du prix par l'assistant, avec tes prix: pour toi seulement (jamais sur le devis ni dans le lien client). */
function EstimatePanel({ doc, estimate, onChange }: { doc: Doc; estimate: DevisEstimate; onChange: (patch: Partial<Doc>) => void }) {
  const s = useSettings();
  const total = estimateTotal(estimate.lines);
  const proposed = priceFromEstimate(total, { taxIncluded: doc.taxIncluded, taxed: doc.applyTps || doc.applyTvq, tpsRate: s.tpsRate, tvqRate: s.tvqRate });
  const current = docPrice(doc);
  const setLine = (i: number, patch: Partial<LineItem>) => onChange({ estimate: { ...estimate, lines: estimate.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) } });
  return (
    <div className="dv-est">
      <div className="dv-est-head">
        <Calculator size={17} />
        <b>Calcul du prix (pour toi, pas sur le devis)</b>
        <button type="button" className="btn icon-btn small" onClick={() => onChange({ estimate: undefined })} aria-label="Retirer le calcul"><X size={15} /></button>
      </div>
      {estimate.note && <div className="small muted">{estimate.note}</div>}
      <div className="dv-est-lines">
        {estimate.lines.map((l, i) => (
          <div key={i} className="dv-est-line">
            <div className="dv-est-desc">{l.code && <b>{l.code}</b>} {l.description}</div>
            <div className="dv-est-calc">
              <NumInput value={l.quantity} aria-label="Quantité" onChange={(n) => setLine(i, { quantity: n })} />
              <span>{l.unit} ×</span>
              <NumInput value={l.unitPrice} aria-label="Prix unitaire" onChange={(n) => setLine(i, { unitPrice: n })} />
              <span>$</span>
              <b>{money(lineAmount(l))}</b>
              <button type="button" className="btn icon-btn small" onClick={() => onChange({ estimate: { ...estimate, lines: estimate.lines.filter((_, j) => j !== i) } })} aria-label="Retirer la ligne"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="dv-est-foot">
        <span>Total avant taxes <b>{money(total)}</b>{proposed !== total ? <> · prix proposé <b>{money(proposed)}</b></> : null}</span>
        {Math.abs(proposed - current) > 0.004 && <button type="button" className="btn small accent" onClick={() => onChange({ items: devisPriceItems(doc.devis!, proposed) })}>Mettre {money(proposed)}</button>}
      </div>
    </div>
  );
}
