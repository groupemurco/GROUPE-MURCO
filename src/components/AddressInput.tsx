import { Building2, MapPin } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { db, type GeoPoint } from '../lib/db';
import { suggestAddresses } from '../lib/geo';

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Appelé quand une suggestion est choisie (adresse exacte + coordonnées). */
  onPick?: (label: string, geo: GeoPoint) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

interface Item {
  label: string;
  sub?: string;
  local?: boolean;
  resolve: () => Promise<{ geo: GeoPoint } | null>;
}

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Adresses déjà dans le système (clients, factures, jobs) qui ressemblent à ce qu'on tape. */
async function localAddresses(q: string): Promise<Item[]> {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const [clients, docs, jobs] = await Promise.all([db.clients.toArray(), db.docs.toArray(), db.jobs.toArray()]);
  const byLabel = new Map<string, Item>();
  const add = (label: string | undefined, sub: string | undefined, geo?: GeoPoint) => {
    const l = label?.trim();
    if (!l) return;
    const n = norm(`${l} ${sub ?? ''}`);
    if (!words.every((w) => n.includes(w))) return;
    const prev = byLabel.get(norm(l));
    if (prev && (prev.sub || !sub)) return;
    byLabel.set(norm(l), { label: l, sub, local: true, resolve: async () => (geo ? { geo } : null) });
  };
  clients.forEach((c) => add(c.address, c.name, c.geo));
  const names = new Map(clients.map((c) => [c.id!, c.name]));
  docs.forEach((d) => add(d.jobAddress, names.get(d.clientId), d.jobGeo));
  jobs.forEach((j) => add(j.address, names.get(j.clientId), j.geo));
  return [...byLabel.values()].slice(0, 3);
}

/** Champ d'adresse: les adresses existent dès qu'on tape (OpenStreetMap ou Google Maps), et celles des clients en premier. */
export function AddressInput({ value, onChange, onPick, placeholder, autoFocus }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({});

  // La liste flotte au-dessus de tout (hors du formulaire): aucun champ, fenêtre ou menu ne peut la cacher
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12;
      const up = below < 190 && r.top > below;
      setPos(up
        ? { position: 'fixed', left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4, top: 'auto', maxHeight: Math.min(r.top - 12, 320) }
        : { position: 'fixed', left: r.left, width: r.width, top: r.bottom + 4, bottom: 'auto', maxHeight: Math.max(120, Math.min(below, 320)) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, items.length]);

  useEffect(() => {
    if (!typed.current) return;
    window.clearTimeout(timer.current);
    const q = value.trim();
    if (q.length < 3) {
      setItems([]);
      setOpen(false);
      return;
    }
    const n = ++seq.current;
    // Les adresses connues s'affichent tout de suite, la recherche en ligne suit
    void localAddresses(q).then((loc) => {
      if (n !== seq.current) return;
      setItems(loc);
      setOpen(loc.length > 0);
      setActive(-1);
    });
    timer.current = window.setTimeout(async () => {
      try {
        const web = await suggestAddresses(q);
        if (n !== seq.current) return;
        const loc = await localAddresses(q);
        const known = new Set(loc.map((x) => norm(x.label)));
        const all = [...loc, ...web.filter((w) => !known.has(norm(w.label))).map((w) => ({ label: w.label, resolve: w.resolve }))];
        setItems(all);
        setOpen(all.length > 0);
      } catch {
        /* hors ligne: les adresses connues restent */
      }
    }, 250);
    return () => window.clearTimeout(timer.current);
  }, [value]);

  const pick = async (s: Item) => {
    setOpen(false);
    typed.current = false;
    onChange(s.label);
    try {
      const r = await s.resolve();
      if (r) onPick?.(s.label, r.geo);
    } catch {
      /* l'adresse sera géocodée plus tard */
    }
  };

  const firstWeb = items.findIndex((x) => !x.local);

  return (
    <div className="addr" ref={wrap} onBlur={() => setTimeout(() => setOpen(false), 200)}>
      <input
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => items.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); void pick(items[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && createPortal(
        <div className="addr-list addr-float" role="listbox" style={pos}>
          {items.map((s, i) => (
            <div key={`${s.local ? 'l' : 'w'}${s.label}`}>
              {i === 0 && s.local && <div className="addr-head">Déjà dans tes dossiers</div>}
              {i === firstWeb && firstWeb > 0 && <div className="addr-head">Adresses</div>}
              <button type="button" role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
                {s.local ? <Building2 size={15} /> : <MapPin size={15} />}
                <span><span className="addr-l">{s.label}</span>{s.sub && <small>{s.sub}</small>}</span>
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
