import { useLiveQuery } from 'dexie-react-hooks';
import { Calculator, Search } from 'lucide-react';
import { useState } from 'react';
import type { CalcRow, LineItem, Service } from '../lib/db';
import { db, UNITS } from '../lib/db';
import { lineAmount, lineHitsMinimum, money, round2 } from '../lib/utils';
import { Modal } from './Modal';
import { NumInput } from './NumInput';

export const emptyLine = (): LineItem => ({ code: '', description: '', unit: '', quantity: 1, unitPrice: 0, minimum: 0 });

export function lineFromService(sv: Service, quantity = 1, lang: 'fr' | 'en' = 'fr'): LineItem {
  return { code: sv.code, description: lang === 'en' && sv.nameEn ? sv.nameEn : sv.name, unit: sv.unit, quantity, unitPrice: sv.price, minimum: sv.minimum };
}

const isEmpty = (it: LineItem) => !it.code && !it.description.trim() && !it.unitPrice;

/** Lignes de facture: on tape un CODE (NDG, LAP…) → le service, l'unité, le prix et le minimum s'affichent. */
export function LineItems({ items, services, onChange, lang = 'fr' }: { items: LineItem[]; services: Service[]; onChange: (items: LineItem[]) => void; lang?: 'fr' | 'en' }) {
  const [calcFor, setCalcFor] = useState<number | null>(null);
  const byCode = new Map(services.map((s) => [s.code.toUpperCase(), s]));

  const upd = (i: number, patch: Partial<LineItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  const setCode = (i: number, raw: string) => {
    const code = raw.toUpperCase().trim();
    const sv = byCode.get(code);
    if (sv) upd(i, { ...lineFromService(sv, items[i].quantity || 1, lang), calc: items[i].calc });
    else upd(i, { code });
  };

  const [q, setQ] = useState('');
  const nq = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // Les plus utilis\u00e9s dans tes documents; le reste s'affiche quand on tape quelques lettres.
  const used = useLiveQuery(async () => {
    const n = new Map<string, number>();
    for (const d of await db.docs.toArray()) for (const l of d.items ?? []) if (l.code) n.set(l.code.toUpperCase(), (n.get(l.code.toUpperCase()) ?? 0) + 1);
    return n;
  }, []);
  const popular = [...services].sort((a, b) => (used?.get(b.code.toUpperCase()) ?? 0) - (used?.get(a.code.toUpperCase()) ?? 0)).slice(0, 5);
  const shown = nq ? services.filter((x) => `${x.code} ${x.name}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(nq)).slice(0, 12) : popular;
  const addService = (sv: Service) => {
    const last = items[items.length - 1];
    const line = lineFromService(sv, 1, lang);
    onChange(last && isEmpty(last) ? [...items.slice(0, -1), line] : [...items, line]);
  };

  return (
    <>
      <datalist id="codes">
        {services.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}
      </datalist>
      <table className="list items-table">
        <thead>
          <tr>
            <th style={{ width: 92 }}>Code</th>
            <th>Service / description</th>
            <th style={{ width: 150 }}>Qté</th>
            <th style={{ width: 92 }}>Unité</th>
            <th style={{ width: 100 }}>Prix / unité</th>
            <th className="num" style={{ width: 110 }}>Montant</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td className="c-code">
                <input className="code-input" list="codes" value={it.code ?? ''} placeholder="CODE" aria-label="Code" onChange={(e) => setCode(i, e.target.value)} />
              </td>
              <td className="c-desc">
                <textarea rows={1} style={{ minHeight: 38 }} value={it.description} placeholder="Service, main-d’œuvre, matériaux…" aria-label="Description" onChange={(e) => upd(i, { description: e.target.value })} />
              </td>
              <td className="c-qty">
                <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                  <NumInput value={it.quantity} aria-label="Quantité" onChange={(n) => upd(i, { quantity: n })} />
                  <button className="btn small icon-btn calc-btn" title="Calculateur pi² / pi lin" aria-label="Calculateur pi² / pi lin" onClick={() => setCalcFor(i)}><Calculator size={16} /></button>
                </div>
              </td>
              <td className="c-unit">
                <input list="units" value={it.unit ?? ''} placeholder="unité" aria-label="Unité" onChange={(e) => upd(i, { unit: e.target.value })} />
              </td>
              <td className="c-price">
                <NumInput value={it.unitPrice} aria-label="Prix" onChange={(n) => upd(i, { unitPrice: n })} />
              </td>
              <td className="num c-amt" style={{ paddingTop: 14 }}>
                <strong>{money(lineAmount(it))}</strong>
                {lineHitsMinimum(it) && <div className="line-min">minimum {money(it.minimum ?? 0)}</div>}
              </td>
              <td className="c-del">
                <button className="btn small danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Retirer">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="units">
        {UNITS.map((u) => <option key={u} value={u} />)}
      </datalist>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => onChange([...items, emptyLine()])}>+ Ligne</button>
        <span className="small muted">Tape un code ou clique un service:</span>
      </div>
      {services.length > 5 && (
        <label className="svc-search">
          <Search size={16} />
          <input value={q} placeholder="Tape 3 lettres du service ou du code…" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); addService(shown[0]); setQ(''); } }} aria-label="Chercher un service" />
        </label>
      )}
      <div className="svc-grid">
        {nq && !shown.length && <span className="small muted">Aucun service trouvé.</span>}
        {shown.map((s) => (
          <button key={s.id} onClick={() => addService(s)} title={`${money(s.price)} / ${s.unit}${s.minimum ? ` · min. ${money(s.minimum)}` : ''}`}>
            <b>{s.code}</b>{s.name}
            <div className="small muted">{money(s.price)} / {s.unit}</div>
          </button>
        ))}
      </div>
      {calcFor !== null && items[calcFor] && (
        <CalcModal
          line={items[calcFor]}
          onClose={() => setCalcFor(null)}
          onApply={(qty, calc) => {
            upd(calcFor, { quantity: qty, calc });
            setCalcFor(null);
          }}
        />
      )}
    </>
  );
}

/** Calculateur: pi² = longueur × hauteur (murs) ou longueur × largeur (terrain); pi lin = somme des longueurs. */
export function CalcModal({ line, onClose, onApply }: { line: LineItem; onClose: () => void; onApply: (qty: number, rows: CalcRow[]) => void }) {
  const [linear, setLinear] = useState(line.unit === 'pi lin');
  const [rows, setRows] = useState<CalcRow[]>(
    line.calc?.length ? line.calc : [{ label: 'Mur avant', a: 0, b: 0 }, { label: 'Mur arrière', a: 0, b: 0 }, { label: 'Côté gauche', a: 0, b: 0 }, { label: 'Côté droit', a: 0, b: 0 }],
  );
  const val = (r: CalcRow) => (linear ? r.a || 0 : (r.a || 0) * (r.b || 0));
  const total = round2(rows.reduce((a, r) => a + val(r), 0));
  const up = (i: number, p: Partial<CalcRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <Modal title={`Calculateur ${linear ? 'pi lin' : 'pi²'}${line.code ? ` — ${line.code}` : ''}`} onClose={onClose}>
      <div className="tabs">
        <button className={!linear ? 'on' : ''} onClick={() => setLinear(false)}>pi² (longueur × hauteur)</button>
        <button className={linear ? 'on' : ''} onClick={() => setLinear(true)}>pi lin (longueurs)</button>
      </div>
      <table className="list">
        <thead>
          <tr><th>Section</th><th>Longueur (pi)</th>{!linear && <th>Hauteur / largeur</th>}<th className="num">{linear ? 'pi lin' : 'pi²'}</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><input value={r.label} onChange={(e) => up(i, { label: e.target.value })} /></td>
              <td><NumInput value={r.a} onChange={(n) => up(i, { a: n })} /></td>
              {!linear && <td><NumInput value={r.b} onChange={(n) => up(i, { b: n })} /></td>}
              <td className="num">{round2(val(r))}</td>
              <td><button className="btn small danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn small" onClick={() => setRows([...rows, { label: `Section ${rows.length + 1}`, a: 0, b: 0 }])}>+ Section</button>
        <div className="spacer" />
        <strong>Total: {total} {linear ? 'pi lin' : 'pi²'}</strong>
      </div>
      <p className="small muted">{linear ? 'Gouttières: additionne la longueur de chaque côté.' : 'Murs: longueur × hauteur. Terrain: longueur × largeur.'}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn accent" onClick={() => onApply(total, rows.filter((r) => r.a))}>Mettre {total} dans la quantité</button>
      </div>
    </Modal>
  );
}
