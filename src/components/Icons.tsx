import type { ReactNode } from 'react';

/** Jeu d'icônes duotone dessiné pour l'app: une forme pleine translucide + un trait net. */
const P = ({ d }: { d: string }) => <path className="d" d={d} />;
const L = ({ d }: { d: string }) => <path d={d} />;

const ICONS = {
  home: <><P d="M4 11.2 12 4l8 7.2V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" /><L d="M4 11.2 12 4l8 7.2V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" /><L d="M10 20.5V15h4v5.5" /></>,
  clients: <><circle className="d" cx="9" cy="8.5" r="3.4" /><circle cx="9" cy="8.5" r="3.4" /><L d="M3.2 19.5c0-3.4 2.6-5.6 5.8-5.6s5.8 2.2 5.8 5.6" /><circle cx="17" cy="9.5" r="2.4" /><L d="M16.6 14.1c2.5.2 4.2 2 4.2 4.9" /></>,
  quote: <><P d="M7 3h7l4.5 4.5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><L d="M7 3h7l4.5 4.5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><L d="M14 3v4.5h4.5M9.2 14.6l2 2 3.8-4.4" /></>,
  invoice: <><P d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><L d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><L d="M9.5 8h5M9.5 12h5" /></>,
  calendar: <><P d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5V10H4z" /><L d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" /><L d="M4 10h16M8 3v4M16 3v4" /></>,
  jobplus: <><P d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5V10H4z" /><L d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" /><L d="M4 10h16M8 3v4M16 3v4M12 12.8v4.8M9.6 15.2h4.8" /></>,
  wallet: <><P d="M3.5 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><L d="M3.5 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><L d="M3.5 10h17M7 15h3.2" /></>,
  settings: <><circle className="d" cx="15" cy="8" r="2.3" /><circle className="d" cx="9" cy="16" r="2.3" /><L d="M4 8h8.7M17.3 8H20M4 16h2.7M11.3 16H20" /><circle cx="15" cy="8" r="2.3" /><circle cx="9" cy="16" r="2.3" /></>,
  grid: <><rect className="d" x="4" y="4" width="6.5" height="6.5" rx="2" /><rect x="4" y="4" width="6.5" height="6.5" rx="2" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="2" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="2" /><rect className="d" x="13.5" y="13.5" width="6.5" height="6.5" rx="2" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" /></>,
  inbox: <><P d="M4 13l2.5-7h11L20 13v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" /><L d="M4 13l2.5-7h11L20 13v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18zM4 13h4.5l1 2h5l1-2H20" /></>,
  briefcase: <><P d="M3.5 8.5A1.5 1.5 0 0 1 5 7h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /><L d="M3.5 8.5A1.5 1.5 0 0 1 5 7h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5zM9 7V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7M3.5 12.5h17" /></>,
  clock: <><circle className="d" cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="8.5" /><L d="M12 7.5V12l3 2" /></>,
  spark: <><P d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><L d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>,
  calc: <><P d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><L d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8.5 6.5h7v3h-7zM9 13h.01M12 13h.01M15 13h.01M9 16.5h.01M12 16.5h.01M15 16.5h.01" /></>,
  cart: <><P d="M7.4 8l1.2 6.5h8.4l1.5-6.5z" /><L d="M3.5 5h2.2l2 10h9.6l1.7-7.5H7M9.5 19.2h.01M16.5 19.2h.01" /></>,
  car: <><P d="M4 12l1.8-4.5a1.5 1.5 0 0 1 1.4-1h9.6a1.5 1.5 0 0 1 1.4 1L20 12v5a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1h-9v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><L d="M4 12l1.8-4.5a1.5 1.5 0 0 1 1.4-1h9.6a1.5 1.5 0 0 1 1.4 1L20 12v5a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1h-9v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 12h16M7.8 14.5h.01M16.2 14.5h.01" /></>,
  folder: <><P d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" /><L d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" /></>,
  chart: <><rect className="d" x="5" y="12" width="3.5" height="7" rx="1" /><rect className="d" x="10.25" y="6" width="3.5" height="13" rx="1" /><rect className="d" x="15.5" y="9.5" width="3.5" height="9.5" rx="1" /><L d="M5 12h3.5v7H5zM10.25 6h3.5v13h-3.5zM15.5 9.5H19V19h-3.5z" /></>,
  book: <><P d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z" /><L d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10" /></>,
  tag: <><P d="M3.5 12.2V5.5A1.5 1.5 0 0 1 5 4h6.7a1.5 1.5 0 0 1 1.06.44l7.3 7.3a1.5 1.5 0 0 1 0 2.12l-6.7 6.7a1.5 1.5 0 0 1-2.12 0l-7.3-7.3A1.5 1.5 0 0 1 3.5 12.2z" /><L d="M3.5 12.2V5.5A1.5 1.5 0 0 1 5 4h6.7a1.5 1.5 0 0 1 1.06.44l7.3 7.3a1.5 1.5 0 0 1 0 2.12l-6.7 6.7a1.5 1.5 0 0 1-2.12 0l-7.3-7.3A1.5 1.5 0 0 1 3.5 12.2zM8 8.2h.01" /></>,
  mail: <><P d="M3.5 6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /><L d="M3.5 6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5zM4 7l8 6 8-6" /></>,
  crown: <><P d="M4 8l4 4 4-6 4 6 4-4-1.5 10h-13z" /><L d="M4 8l4 4 4-6 4 6 4-4-1.5 10h-13z" /></>,
  collect: <><circle className="d" cx="12" cy="7.5" r="3.6" /><circle cx="12" cy="7.5" r="3.6" /><L d="M12 6.2v2.6M4 15v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18v-3M8.6 14.2 12 17.4l3.4-3.2M12 11.5v5.9" /></>,
  bell: <><P d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z" /><L d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14zM10 20.5a2 2 0 0 0 4 0" /></>,
  bolt: <><P d="M13 3 5.5 13.5H11L10 21l8-11h-5.5z" /><L d="M13 3 5.5 13.5H11L10 21l8-11h-5.5z" /></>,
  checklist: <><rect className="d" x="3.5" y="4" width="17" height="16" rx="3" /><L d="M9.5 7h8M9.5 12h8M9.5 17h8M4.8 7l1.2 1.2L8 5.8M4.8 12l1.2 1.2L8 10.8M4.8 17l1.2 1.2L8 15.8" /></>,
  sun: <><circle className="d" cx="12" cy="12" r="4.2" /><circle cx="12" cy="12" r="4.2" /><L d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
} satisfies Record<string, ReactNode>;

export type IcoName = keyof typeof ICONS;

export function Ico({ n, size = 22 }: { n: IcoName; size?: number }) {
  return (
    <svg className="ico-duo" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[n]}
    </svg>
  );
}

/** Pour les tableaux qui attendent un composant d'icône (menu). */
export const duo = (n: IcoName) =>
  function DuoIcon({ size }: { size?: number }) {
    return <Ico n={n} size={size} />;
  };
