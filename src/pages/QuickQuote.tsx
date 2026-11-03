import { Mic, Sparkles, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DEVIS_MAIL_KEY, DEVIS_QUESTIONS_KEY } from '../components/DevisEditor';
import { PageHero } from '../components/PageHero';
import { errMsg, useToast } from '../components/Toast';
import { getSettings } from '../lib/db';
import { createQuoteFromText } from '../lib/devisFlow';
import { listen, speechSupported, type Listening } from '../lib/speech';

const EXAMPLE = 'Denise Tremblay, 819 555-0101, 45 rue des Pins à Magog. Calfeutrage de 6 fenêtres au sous-sol, 9 au rez-de-chaussée et la porte de garage.';

function takeMail(): string {
  try {
    const t = sessionStorage.getItem(DEVIS_MAIL_KEY) ?? '';
    sessionStorage.removeItem(DEVIS_MAIL_KEY);
    return t;
  } catch {
    return '';
  }
}

/** Soumission en un clic: une phrase (écrite, dictée ou le courriel du client) → client + soumission avec prix, prête à envoyer. */
export default function QuickQuote() {
  const nav = useNavigate();
  const notify = useToast();
  const [text, setText] = useState(takeMail);
  const [busy, setBusy] = useState('');
  const [hearing, setHearing] = useState(false);
  const rec = useRef<Listening | null>(null);
  useEffect(() => () => rec.current?.stop(), []);

  const mic = () => {
    if (rec.current) return rec.current.stop();
    const before = text.trim();
    rec.current = listen(
      (t) => setText(before ? `${before} ${t}` : t),
      (err, t) => {
        rec.current = null;
        setHearing(false);
        if (t?.trim()) setText(before ? `${before} ${t.trim()}` : t.trim());
        else if (err) notify(err, 'err');
      },
    );
    if (rec.current) setHearing(true);
    else notify('La dictée n’est pas disponible ici: écris la phrase.', 'err');
  };

  const create = async () => {
    const t = text.trim();
    if (t.length < 8) return notify('Écris ou dis le client et la job (ex.: le nom, le téléphone, l’adresse et ce qu’il faut faire).', 'err');
    rec.current?.stop();
    setBusy('L’assistant lit ta demande et prépare la soumission…');
    try {
      const r = await createQuoteFromText(t, await getSettings());
      try {
        if (r.questions.length) sessionStorage.setItem(DEVIS_QUESTIONS_KEY, JSON.stringify(r.questions));
      } catch {
        /* ignore */
      }
      notify(r.failed ? `${r.failed} ${r.message}` : r.message, r.failed ? 'err' : undefined);
      nav(`/doc/${r.id}?pret=1`);
    } catch (e) {
      notify(errMsg(e), 'err');
      setBusy('');
    }
  };

  return (
    <>
      <PageHero eyebrow="Assistant" title="Soumission en un clic" sub="Écris ou dis tout d’un coup: le client, son téléphone, l’adresse et la job. L’assistant crée le client et la soumission avec un prix approximatif." />
      <div className="card qq">
        <textarea className="qq-text" rows={7} autoFocus value={text} disabled={!!busy} onChange={(e) => setText(e.target.value)}
          placeholder={`ex.: ${EXAMPLE}\n\nTu peux aussi coller le courriel du client au complet.`} />
        {!text && <button type="button" className="chip-btn qq-example" onClick={() => setText(EXAMPLE)}>Essayer avec un exemple</button>}
        <div className="qq-actions">
          {speechSupported() && (
            <button type="button" className={`btn big ${hearing ? 'danger' : ''}`} disabled={!!busy} onClick={mic}>
              {hearing ? <><Square size={18} /> Arrêter</> : <><Mic size={20} /> Dicter</>}
            </button>
          )}
          <button type="button" className="btn accent big qq-go" disabled={!!busy} onClick={() => void create()}>
            <Sparkles size={20} /> {busy ? 'Création…' : 'Créer la soumission'}
          </button>
        </div>
        {busy ? <div className="qq-busy"><span className="qq-spin" /> {busy}</div> : (
          <ul className="qq-how small muted">
            <li>Le client est retrouvé ou ajouté (nom, téléphone, courriel, adresse).</li>
            <li>La soumission est rédigée avec le prix calculé selon tes prix; tu peux tout changer.</li>
            <li>Rien n’est envoyé au client avant que tu le décides. La facture se fait en un clic quand c’est accepté.</li>
          </ul>
        )}
      </div>
      <div className="small muted" style={{ textAlign: 'center' }}>
        Tu préfères la faire toi-même? <Link to="/doc/new?type=quote&format=lignes">Soumission à la main</Link>
      </div>
    </>
  );
}
