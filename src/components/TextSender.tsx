import { Copy, MessageSquare } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { isNative } from '../lib/native';
import { Modal } from './Modal';
import { useToast } from './Toast';

/** Un texto peut partir d'ici (cellulaire ou app installée); sur l'ordi, il n'y a pas d'app de textos. */
export const canTextHere = () => isNative() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Format reconnu par l'appareil photo des cellulaires (Android et iPhone): le texto s'ouvre déjà écrit. */
const smsQr = (phone: string, text: string) => `SMSTO:${phone.replace(/[^\d+]/g, '')}:${text}`;

/** Texto depuis l'ordi: on scanne le code avec son cell (texto prêt à envoyer), ou on copie le message. */
export function SmsFromComputer({ phone, text, name, onClose }: { phone: string; text: string; name?: string; onClose: () => void }) {
  const notify = useToast();
  const [msg, setMsg] = useState(text);
  const [qr, setQr] = useState('');
  useEffect(() => {
    QRCode.toDataURL(smsQr(phone, msg), { width: 360, margin: 1, errorCorrectionLevel: 'L', color: { dark: '#23262b', light: '#ffffff' } }).then(setQr).catch(() => setQr(''));
  }, [phone, msg]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg);
      notify('Message copié: colle-le dans tes textos, Messenger ou courriel');
    } catch {
      notify('Sélectionne et copie le message.', 'err');
    }
  };
  return (
    <Modal title="Envoyer le texto avec ton cell" onClose={onClose}>
      <div className="sms-pc">
        <div className="sms-pc-qr">
          {qr ? <img src={qr} alt={`Code du texto pour ${name || phone}`} /> : <div className="small muted">Préparation du code…</div>}
          <div className="small"><MessageSquare size={14} /> {name ? `${name} · ` : ''}{phone}</div>
        </div>
        <div className="sms-pc-how">
          <b>Sur l’ordi, il n’y a pas d’app de textos.</b>
          <ol>
            <li>Ouvre l’appareil photo de ton cell et vise le code.</li>
            <li>Touche le lien qui apparaît: le texto s’ouvre, déjà écrit, au bon numéro.</li>
            <li>Appuie sur Envoyer.</li>
          </ol>
          <label className="field">Message (le code se met à jour si tu le changes)
            <textarea rows={7} value={msg} onChange={(e) => setMsg(e.target.value)} />
          </label>
          <button type="button" className="btn" onClick={() => void copy()}><Copy size={16} /> Copier le message</button>
        </div>
      </div>
    </Modal>
  );
}
