import { useEffect } from 'react';
import { useToast } from './Toast';

/** Petit message dans l'app quand un client ouvre ou signe un lien (la page doit être ouverte et connectée). */
export function PortalWatcher() {
  const notify = useToast();
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ kind: 'viewed' | 'signed'; number: string; type: string; name: string }>).detail;
      const what = d.type === 'quote' ? 'la soumission' : 'la facture';
      notify(d.kind === 'signed' ? `${d.name || 'Le client'} a signé ${what} ${d.number}` : `${d.name || 'Le client'} a ouvert ${what} ${d.number}`);
    };
    window.addEventListener('murco:portal', on);
    return () => window.removeEventListener('murco:portal', on);
  }, [notify]);
  return null;
}
