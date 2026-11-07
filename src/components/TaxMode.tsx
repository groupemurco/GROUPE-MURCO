import type { Doc } from '../lib/db';

type TaxFields = Pick<Doc, 'applyTps' | 'applyTvq' | 'taxIncluded'>;

/** Comment les taxes s'ajoutent: en plus du prix, déjà comprises, ou pas du tout. */
export function TaxMode({ doc, onChange }: { doc: TaxFields; onChange: (p: TaxFields) => void }) {
  const mode = !doc.applyTps && !doc.applyTvq ? 'none' : doc.taxIncluded ? 'incl' : 'plus';
  const set = (m: 'plus' | 'incl' | 'none') => onChange(m === 'none' ? { applyTps: false, applyTvq: false, taxIncluded: false } : { applyTps: true, applyTvq: true, taxIncluded: m === 'incl' });
  return (
    <div className="tax-mode">
      <div className="tax-mode-q">Taxes (TPS + TVQ)</div>
      <div className="seg" role="tablist" aria-label="Taxes">
        <button type="button" role="tab" aria-selected={mode === 'plus'} className={mode === 'plus' ? 'on' : ''} onClick={() => set('plus')}>+ Ajouter les taxes</button>
        <button type="button" role="tab" aria-selected={mode === 'incl'} className={mode === 'incl' ? 'on' : ''} onClick={() => set('incl')}>Taxes incluses</button>
        <button type="button" role="tab" aria-selected={mode === 'none'} className={mode === 'none' ? 'on' : ''} onClick={() => set('none')}>Sans taxes</button>
      </div>
    </div>
  );
}
