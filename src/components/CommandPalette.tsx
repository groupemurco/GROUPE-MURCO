import { useLiveQuery } from 'dexie-react-hooks';
import {
  CalendarDays, Camera, Car, FileText, ClipboardList, Package, Search, Settings, Tag, User, Users, Zap, Home, Mail, Briefcase, type LucideIcon, ScrollText,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { useSettings } from '../lib/hooks';
import { docTotals, money } from '../lib/utils';

interface Item {
  group: string;
  label: string;
  sub?: string;
  icon: LucideIcon;
  to: string;
  keywords?: string;
}

const ACTIONS: Item[] = [
  { group: 'Actions', label: 'Facture express', sub: 'en 30 secondes', icon: Zap, to: '/express', keywords: 'rapide nouvelle facture vite' },
  { group: 'Actions', label: 'Nouvelle facture', icon: FileText, to: '/doc/new?type=invoice', keywords: 'creer' },
  { group: 'Actions', label: 'Nouvelle soumission', icon: ClipboardList, to: '/doc/new?type=quote&format=lignes', keywords: 'devis estimation' },
  { group: 'Actions', label: 'Nouveau devis détaillé', icon: ScrollText, to: '/doc/new?type=quote&format=devis', keywords: 'devis soumission forfait calfeutrage redige' },
  { group: 'Actions', label: 'Planifier un job', icon: CalendarDays, to: '/job/new', keywords: 'agenda rendez-vous' },
  { group: 'Actions', label: 'Photo de reçu', icon: Camera, to: '/depenses/new', keywords: 'depense essence' },
  { group: 'Actions', label: 'Ajouter un déplacement', icon: Car, to: '/km?add=1', keywords: 'km kilometrage' },
  { group: 'Pages', label: 'Tableau de bord', icon: Home, to: '/' },
  { group: 'Pages', label: 'Demandes (CRM)', icon: Users, to: '/demandes', keywords: 'leads prospects pipeline' },
  { group: 'Pages', label: 'Pointage', icon: CalendarDays, to: '/pointage', keywords: 'punch heures' },
  { group: 'Pages', label: 'Feuilles de temps', icon: CalendarDays, to: '/temps', keywords: 'heures paie employes' },
  { group: 'Pages', label: 'Équipe', icon: Users, to: '/equipe', keywords: 'employes vendeurs inviter' },
  { group: 'Pages', label: 'Projets', icon: Briefcase, to: '/projets', keywords: 'chantier budget' },
  { group: 'Pages', label: 'Ventes et commissions', icon: Package, to: '/rapports?t=ventes', keywords: 'vendeur conversion' },
  { group: 'Pages', label: 'Agenda', icon: CalendarDays, to: '/agenda' },
  { group: 'Pages', label: 'Factures', icon: FileText, to: '/factures' },
  { group: 'Pages', label: 'Soumissions', icon: ClipboardList, to: '/soumissions' },
  { group: 'Pages', label: 'Clients', icon: Users, to: '/clients' },
  { group: 'Pages', label: 'Codes et prix', icon: Tag, to: '/codes' },
  { group: 'Pages', label: 'Rentabilité', icon: Package, to: '/rapports', keywords: 'profit marge rapport' },
  { group: 'Pages', label: 'Rapport TPS / TVQ', icon: Package, to: '/rapports?t=taxes', keywords: 'taxes declaration revenu quebec' },
  { group: 'Pages', label: 'Journal de bord', icon: Car, to: '/km' },
  { group: 'Pages', label: 'Reçus et dépenses', icon: Camera, to: '/depenses' },
  { group: 'Pages', label: 'Classeur (tous les documents)', icon: Package, to: '/classeur', keywords: 'photos fichiers archives' },
  { group: 'Pages', label: 'Gmail', icon: Mail, to: '/gmail' },
  { group: 'Pages', label: 'Dossier comptable', icon: Package, to: '/comptable' },
  { group: 'Pages', label: 'Paramètres', icon: Settings, to: '/parametres' },
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Recherche rapide (Ctrl+K): actions, pages, clients, factures, soumissions, jobs. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const s = useSettings();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const data = useLiveQuery(async () => {
    const [clients, docs, jobs, leads] = await Promise.all([db.clients.toArray(), db.docs.toArray(), db.jobs.toArray(), db.leads.toArray()]);
    return { clients, docs, jobs, leads };
  }, []);

  const items = useMemo(() => {
    const out: Item[] = [...ACTIONS];
    if (data) {
      const cname = new Map(data.clients.map((c) => [c.id, c.name]));
      data.leads.forEach((l) => out.push({ group: 'Demandes', label: l.name, sub: l.service, icon: User, to: '/demandes', keywords: `${l.phone} ${l.email} ${l.address}` }));
      data.clients.forEach((c) => out.push({ group: 'Clients', label: c.name, sub: c.address, icon: User, to: `/clients/${c.id}`, keywords: `${c.email} ${c.phone} ${c.contact}` }));
      [...data.docs].sort((a, b) => b.date.localeCompare(a.date)).forEach((d) =>
        out.push({
          group: d.type === 'invoice' ? 'Factures' : 'Soumissions',
          label: `${d.number} — ${cname.get(d.clientId) ?? ''}`,
          sub: `${d.title} · ${money(docTotals(d, s).total)}`,
          icon: d.type === 'invoice' ? FileText : ClipboardList,
          to: `/doc/${d.id}`,
          keywords: `${d.jobAddress} ${d.items.map((i) => i.code).join(' ')}`,
        }),
      );
      [...data.jobs].sort((a, b) => b.date.localeCompare(a.date)).forEach((j) =>
        out.push({ group: 'Jobs', label: `${j.date} — ${cname.get(j.clientId) ?? ''}`, sub: j.title, icon: Briefcase, to: `/job/${j.id}`, keywords: j.address }),
      );
    }
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return out.filter((i) => i.group === 'Actions' || i.group === 'Pages');
    return out.filter((i) => {
      const hay = norm(`${i.label} ${i.sub ?? ''} ${i.keywords ?? ''} ${i.group}`);
      return words.every((w) => hay.includes(w));
    }).slice(0, 40);
  }, [q, data, s]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const go = (it?: Item) => {
    if (!it) return;
    onClose();
    nav(it.to);
  };

  let lastGroup = '';
  return (
    <div className="modal-bg cmdk-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cmdk" role="dialog" aria-label="Recherche rapide">
        <div className="cmdk-input">
          <Search size={20} />
          <input
            autoFocus
            value={q}
            placeholder="Chercher un client, une facture, une action…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(x + 1, items.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
              else if (e.key === 'Enter') go(items[sel]);
              else if (e.key === 'Escape') onClose();
            }}
          />
          <kbd className="small muted">Échap</kbd>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {items.length === 0 && <div className="empty">Aucun résultat</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="cmdk-group">{it.group}</div> : null;
            lastGroup = it.group;
            const Icon = it.icon;
            return (
              <div key={`${it.to}-${i}`}>
                {head}
                <button className={`cmdk-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(it)}>
                  <Icon size={18} />
                  <span>{it.label}</span>
                  {it.sub && <span className="sub">{it.sub}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
