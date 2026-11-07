import { Camera, CircleCheck, FileText, Mail, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobToInvoice, smsLink } from '../lib/agenda';
import { db, type Client, type Job } from '../lib/db';
import { haptic } from '../lib/feel';
import { useSettings } from '../lib/hooks';
import { companyTexts, moneyFor } from '../lib/docLang';
import { publishPortal } from '../lib/portal';
import { docTotals, km, money } from '../lib/utils';
import { EstimateFollowUp } from './EstimateFollowUp';
import { Modal } from './Modal';
import { errMsg, useToast } from './Toast';

/**
 * Juste après « Fait »: facturer et envoyer en un geste (texto avec le lien client, ou courriel avec le PDF),
 * ou ajouter les photos avant/après.
 */
export function JobDoneSheet({ job, client, canBill, routeKm, onClose }: { job: Job; client?: Client; canBill: boolean; routeKm?: number; onClose: () => void }) {
  const nav = useNavigate();
  const s = useSettings();
  const notify = useToast();
  const [busy, setBusy] = useState('');
  if (job.type === 'estimation') return <EstimateFollowUp job={job} client={client} onClose={onClose} />;

  const textInvoice = async () => {
    if (!client?.phone) return;
    setBusy('Préparation de la facture…');
    try {
      const id = await jobToInvoice(job.id!);
      const d = (await db.docs.get(id))!;
      let link = '';
      try {
        link = await publishPortal(id);
      } catch {
        notify('Facture envoyée sans lien en ligne (active la synchro pour le lien client et le paiement par carte).', 'err');
      }
      const tt = docTotals(d, s);
      const who = client.contact || client.name;
      const text = (client.lang === 'en'
        ? `Hello ${who}, thank you for your business! Here is your invoice ${d.number} for ${moneyFor(tt.total, 'en')}${link ? `: ${link}` : '.'} ${companyTexts(s, 'en').paymentInstructions}`
        : `Bonjour ${who}, merci pour votre confiance! Voici votre facture ${d.number} de ${money(tt.total)}${link ? `: ${link}` : '.'} ${s.paymentInstructions}`).trim();
      if (d.status === 'draft') await db.docs.update(id, { status: 'sent', sentAt: new Date().toISOString() });
      haptic('success');
      window.location.href = smsLink(client.phone, text);
      setTimeout(() => nav(`/doc/${id}`), 600);
    } catch (e) {
      notify(errMsg(e), 'err');
    } finally {
      setBusy('');
    }
  };

  const go = async (mode: 'courriel' | 'voir') => {
    setBusy('Préparation de la facture…');
    try {
      const id = await jobToInvoice(job.id!);
      nav(mode === 'courriel' ? `/doc/${id}?envoyer=courriel` : `/doc/${id}`);
    } catch (e) {
      notify(errMsg(e), 'err');
      setBusy('');
    }
  };

  return (
    <Modal title="Job terminée" onClose={onClose}>
      <div className="done-hero">
        <CircleCheck size={44} />
        <div>
          <strong>{client?.name ?? 'Client'}</strong>
          <div className="small muted">{job.title}{routeKm ? ` · route du jour ${km(routeKm)} au journal de bord` : ''}</div>
        </div>
      </div>
      {busy && <div className="notice info">{busy}</div>}
      <div className="done-actions">
        {canBill && client?.phone && (
          <button className="done-btn primary" disabled={!!busy} onClick={() => void textInvoice()}>
            <MessageSquare size={22} /><span><strong>Facturer et texter au client</strong><small>Lien pour voir et payer la facture · {client.phone}</small></span>
          </button>
        )}
        {canBill && (
          <button className={`done-btn ${client?.phone ? '' : 'primary'}`} disabled={!!busy} onClick={() => void go('courriel')}>
            <Mail size={22} /><span><strong>Facturer et envoyer par courriel</strong><small>{client?.email || 'PDF de la facture en pièce jointe'}</small></span>
          </button>
        )}
        <button className="done-btn" disabled={!!busy} onClick={() => nav(`/job/${job.id}?photo=1`)}>
          <Camera size={22} /><span><strong>Photos avant / après</strong><small>Preuve du travail, jointe à la facture</small></span>
        </button>
        {canBill && (
          <button className="done-btn" disabled={!!busy} onClick={() => void go('voir')}>
            <FileText size={22} /><span><strong>Voir la facture d’abord</strong><small>Ajuster les quantités ou le prix</small></span>
          </button>
        )}
      </div>
      <button className="btn block" style={{ marginTop: 10 }} onClick={onClose}>Plus tard</button>
    </Modal>
  );
}
