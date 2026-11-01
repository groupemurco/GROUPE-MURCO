import { ArrowDown, ArrowUp, BookmarkPlus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { saveSettings, type Doc, type LineItem } from '../lib/db';
import { DEVIS_TEMPLATES, devisFromTemplate, devisFromText, devisLineDescription, devisTitle, sectionTotalText, templateKeyFor, type Devis, type DevisSection } from '../lib/devis';
import { useSettings } from '../lib/hooks';
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

/** Devis de départ pour l'entreprise (selon son métier). */
export function starterDevis(s: Parameters<typeof activeTrades>[0] & { devisTemplates?: { name: string; devis: Devis }[] }): Devis {
  return devisFromTemplate(templateKeyFor(activeTrades(s)), s.devisTemplates);
}

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
  const [aiOpen, setAiOpen] = useState(false);
  const saved = s.devisTemplates ?? [];

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
      <div className="dv-tools">
        <select className="dv-tpl" value="" onChange={(e) => void pickTemplate(e.target.value)} aria-label="Modèle de devis">
          <option value="">Partir d’un modèle…</option>
          {saved.length > 0 && <optgroup label="Mes modèles">{saved.map((x) => <option key={x.name} value={`perso:${x.name}`}>{x.name}</option>)}</optgroup>}
          <optgroup label="Modèles par métier">{DEVIS_TEMPLATES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
        </select>
        <button type="button" className="btn small" onClick={() => setAiOpen(true)}><Sparkles size={15} /> Écrire avec l’assistant</button>
        <button type="button" className="btn small" onClick={() => setSaving(d.heading.replace(/^soumission\s+(de\s+|d[’']|pour\s+)?/i, '').replace(/^./, (c) => c.toUpperCase()))}><BookmarkPlus size={15} /> Enregistrer comme modèle</button>
      </div>

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
      {aiOpen && <AiDevisModal doc={doc} onClose={() => setAiOpen(false)} onDone={(patch) => { onChange(patch); setAiOpen(false); }} />}
    </div>
  );
}

function AiDevisModal({ doc, onClose, onDone }: { doc: Doc; onClose: () => void; onDone: (patch: Partial<Doc>) => void }) {
  const s = useSettings();
  const notify = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const base = doc.devis!;
  const go = async () => {
    if (text.trim().length < 4) return notify('Décris la job en quelques mots.', 'err');
    setBusy(true);
    let r: { devis: Devis; price?: number; taxIncluded?: boolean; address?: string };
    try {
      const { aiDevis } = await import('../lib/ai');
      const trades = activeTrades(s).map((k) => tradeOf(k)?.label).filter(Boolean).join(', ');
      r = await aiDevis({ company: s.companyName, trades, description: text.trim(), base, model: s.aiModel || undefined });
    } catch (e) {
      // Sans l'IA: chaque morceau de la phrase devient un point, le prix et les taxes sont repérés
      r = devisFromText(text, base);
      notify(`Fait sans l’assistant (${errMsg(e).slice(0, 80)}). Vérifie le texte.`, 'err');
    }
    setBusy(false);
    const price = r.price ?? docPrice(doc);
    onDone({
      devis: r.devis,
      items: devisPriceItems(r.devis, price),
      ...(r.taxIncluded !== undefined ? { taxIncluded: r.taxIncluded } : {}),
      ...(r.address && !doc.jobAddress ? { jobAddress: r.address } : {}),
    });
  };
  return (
    <Modal title="Écrire le devis avec l’assistant" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Dis ce qui est à faire et le prix. L’assistant écrit le devis dans le style de ton modèle; tu pourras tout modifier.</p>
      <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="ex.: calfeutrage de 5 fenêtres au sous-sol, 8 au rez-de-chaussée, la porte d’entrée et la porte-patio, 1650 $ taxes incluses" />
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>Annuler</button>
        <button type="button" className="btn accent" disabled={busy} onClick={() => void go()}><Sparkles size={16} /> {busy ? 'Rédaction…' : 'Écrire le devis'}</button>
      </div>
    </Modal>
  );
}
