import { Download, Eye } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSettings, type Client, type Doc } from '../lib/db';
import { makeDocPdf } from '../lib/docPdf';
import { docFileName } from '../lib/pdf';
import { downloadBlob } from '../lib/utils';
import { useToast } from './Toast';
import { Modal } from './Modal';
import { PdfView } from './PdfView';

/** Aperçu de la facture ou de la soumission (le même PDF que le client reçoit), sans quitter la liste. */
export function DocPreview({ doc, client, onClose }: { doc: Doc; client?: Client; onClose: () => void }) {
  const nav = useNavigate();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let off = false;
    void (async () => {
      try {
        const b = await makeDocPdf(doc, client, await getSettings());
        if (!off) setBlob(b);
      } catch {
        if (!off) setErr('Aperçu impossible pour le moment. Ouvre le document pour le voir.');
      }
    })();
    return () => {
      off = true;
    };
  }, [doc, client]);

  return (
    <Modal title={`${doc.type === 'invoice' ? 'Facture' : 'Soumission'} ${doc.number}`} onClose={onClose}>
      {blob ? <PdfView blob={blob} /> : err ? <div className="notice err">{err}</div> : <div className="small muted" style={{ padding: '18px 0' }}>Préparation de l’aperçu…</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={onClose}>Fermer</button>
        <button className="btn" disabled={!blob} onClick={() => blob && downloadBlob(blob, docFileName(doc, client))}><Download size={16} /> Télécharger</button>
        <button className="btn accent" onClick={() => { onClose(); nav(`/doc/${doc.id}`); }}>Ouvrir</button>
      </div>
    </Modal>
  );
}

/** Boutons « Aperçu » et « PDF » d'une ligne de liste (ne déclenchent pas l'ouverture de la ligne ni le glissement). */
export function PreviewButton({ doc, client, label = true }: { doc: Doc; client?: Client; label?: boolean }) {
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const download = async () => {
    setBusy(true);
    try {
      downloadBlob(await makeDocPdf(doc, client, await getSettings()), docFileName(doc, client));
    } catch {
      notify('Téléchargement impossible pour le moment. Ouvre le document et réessaie.', 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="pv-group">
      <button
        type="button"
        className="btn small preview-btn"
        aria-label={`Aperçu ${doc.number}`}
        onPointerDown={stop}
        onMouseDown={stop}
        onTouchStart={stop}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <Eye size={14} /> {label && 'Aperçu'}
      </button>
      <button
        type="button"
        className="btn small preview-btn"
        aria-label={`Télécharger ${doc.number} en PDF`}
        title="Télécharger le PDF"
        disabled={busy}
        onPointerDown={stop}
        onMouseDown={stop}
        onTouchStart={stop}
        onClick={(e) => { e.stopPropagation(); void download(); }}
      >
        <Download size={14} /> {label && 'PDF'}
      </button>
      {open && <DocPreview doc={doc} client={client} onClose={() => setOpen(false)} />}
    </span>
  );
}
