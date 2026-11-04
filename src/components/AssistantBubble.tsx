import { MessageCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { aiConfigured } from '../lib/ai';
import type { Settings } from '../lib/db';

/** Bulle de chat flottante: la secrétaire IA est à un clic, peu importe la page. */
export function AssistantBubble({ s }: { s: Settings }) {
  const loc = useLocation();
  if (!aiConfigured(s.aiAssistant) || loc.pathname.startsWith('/dicter')) return null;
  const name = s.aiName?.trim() || 'Léa';
  return (
    <Link to="/dicter" className="ai-bubble" aria-label={`Parler à ${name}`} title={`Parler à ${name}`}>
      {s.aiPhoto ? <img src={s.aiPhoto} alt="" /> : <span className="ai-bubble-initial">{name.slice(0, 1).toUpperCase()}</span>}
      <i className="ai-bubble-chat"><MessageCircle size={13} /></i>
    </Link>
  );
}
