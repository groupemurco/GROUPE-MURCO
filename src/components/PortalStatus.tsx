import { Eye, PenLine, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { Doc } from '../lib/db';
import { checkPortal, publishPortal } from '../lib/portal';
import { errMsg, useToast } from './Toast';

const fmt = (iso: string) => new Date(iso).toLocaleString('fr-CA', { dateStyle: 'long', timeStyle: 'short' });

/** Où en est le lien envoyé au client: publié? ouvert? signé? + « Vérifier maintenant ». */
export function PortalStatus({ doc }: { doc: Doc }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  if (!doc.id || (doc.status === 'draft' && !doc.portalToken)) return null;
  const quote = doc.type === 'quote';

  const verify = async () => {
    setBusy(true);
    try {
      if (!doc.portalToken) {
        await publishPortal(doc.id!, { wait: true });
        notify('Lien client créé. Envoie-le avec « Texto » ou « Courriel ».');
        return;
      }
      const r = await checkPortal(doc.id!);
      if (!r.exists) notify('Le lien n’existe pas en ligne. Renvoie le texto ou le courriel pour le recréer.', 'err');
      else if (r.signed) notify('Le client a signé.');
      else if (r.viewedAt) notify('Le client a ouvert le lien, pas encore signé.');
      else notify('Le client n’a pas encore ouvert le lien.');
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notice info portal-status">
      <div className="ps-lines">
        <strong>Suivi du lien client</strong>
        {!doc.portalToken && <span>Aucun lien en ligne n’a été créé pour ce document.</span>}
        {doc.portalToken && (
          <>
            <span><Eye size={14} /> {doc.viewedAt ? `Ouvert par le client le ${fmt(doc.viewedAt)}` : 'Pas encore ouvert par le client'}</span>
            {quote && <span><PenLine size={14} /> {doc.signature ? `Signée par ${doc.signature.name} le ${fmt(doc.signature.at)}` : 'Pas encore signée'}</span>}
          </>
        )}
      </div>
      <button className="btn small" disabled={busy} onClick={() => void verify()}><RefreshCw size={14} /> {doc.portalToken ? 'Vérifier maintenant' : 'Créer le lien'}</button>
    </div>
  );
}
