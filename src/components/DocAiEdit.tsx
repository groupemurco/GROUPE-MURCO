import { Sparkles, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { aiConfigured, aiEditDoc, aiErrorMessage, type DocPatch } from '../lib/ai';
import { type Doc, type LineItem, type Service } from '../lib/db';
import { useSettings } from '../lib/hooks';
import { addDays } from '../lib/utils';

const IDEAS = ['Ajoute un rabais de 50 $', 'Change le prix à 450 $', 'Ajoute un dépôt de 200 $', 'Les taxes en plus', 'Enlève la dernière ligne'];

/** « Modifie ça, ça et ça »: l'assistant change la facture ou la soumission (lignes, prix, rabais, dépôt, taxes, notes…). */
export function DocAiEdit({ doc, services, onApply }: { doc: Doc; services: Service[]; onApply: (patch: Partial<Doc>) => void }) {
  const s = useSettings();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [undo, setUndo] = useState<Partial<Doc> | null>(null);
  if (!aiConfigured(s.aiAssistant)) return null;

  const toPatch = (p: DocPatch): Partial<Doc> => {
    const out: Partial<Doc> = {};
    if (p.items) {
      out.items = p.items.map((l): LineItem => {
        const sv = l.code ? services.find((x) => x.code.toUpperCase() === l.code!.toUpperCase()) : undefined;
        return {
          code: sv?.code ?? '', description: l.description || sv?.name || 'Travaux', unit: l.unit || sv?.unit, quantity: l.quantity > 0 ? l.quantity : 1,
          unitPrice: l.unitPrice ?? sv?.price ?? 0, ...(sv?.minimum ? { minimum: sv.minimum } : {}),
        };
      });
    }
    if (p.discount !== undefined) out.discount = p.discount;
    if (p.deposit !== undefined) out.deposit = p.deposit;
    if (p.title !== undefined) out.title = p.title;
    if (p.notes !== undefined) out.notes = p.notes;
    if (p.jobAddress !== undefined) { out.jobAddress = p.jobAddress; out.jobGeo = undefined; }
    if (p.dueInDays !== undefined) out.dueDate = addDays(doc.date, p.dueInDays);
    if (p.taxes) Object.assign(out, p.taxes === 'none' ? { applyTps: false, applyTvq: false, taxIncluded: false } : { applyTps: true, applyTvq: true, taxIncluded: p.taxes === 'incl' });
    return out;
  };

  const run = async (t: string) => {
    const ask = t.trim();
    if (!ask || busy) return;
    setBusy(true);
    setMsg('');
    try {
      const p = await aiEditDoc({ doc, services: services.map((x) => ({ code: x.code, name: x.name, unit: x.unit, price: x.price })), text: ask, company: s.companyName, model: s.aiModel || undefined });
      const patch = toPatch(p);
      if (!Object.keys(patch).length) {
        setMsg(p.explication || 'Je n’ai rien trouvé à changer. Dis-moi précisément quoi (ex.: « mets 6 $ du pied linéaire »).');
      } else {
        const before: Partial<Doc> = {};
        for (const k of Object.keys(patch) as (keyof Doc)[]) (before as Record<string, unknown>)[k] = doc[k];
        setUndo(before);
        onApply(patch);
        setMsg(p.explication || 'C’est fait. Vérifie, puis enregistre.');
        setText('');
      }
    } catch (e) {
      setMsg(aiErrorMessage(e).replace(' J’utilise l’assistant de base.', ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="doc-ai">
      <form className="doc-ai-row" onSubmit={(e) => { e.preventDefault(); void run(text); }}>
        <Sparkles size={18} className="doc-ai-ico" />
        <input value={text} placeholder="Dis à l’assistant quoi modifier…" aria-label="Demande à l’assistant" onChange={(e) => setText(e.target.value)} disabled={busy} />
        <button type="submit" className="btn small accent" disabled={busy || !text.trim()}>{busy ? 'Un instant…' : 'Modifier'}</button>
      </form>
      {!text && !msg && <div className="doc-ai-ideas">{IDEAS.map((i) => <button key={i} type="button" className="chip-btn" onClick={() => setText(i)}>{i}</button>)}</div>}
      {msg && (
        <div className="doc-ai-msg">
          <span>{msg}</span>
          {undo && <button type="button" className="btn small" onClick={() => { onApply(undo); setUndo(null); setMsg('Changement annulé.'); }}><Undo2 size={13} /> Annuler</button>}
        </div>
      )}
    </div>
  );
}
