// Message personnalisé au client (texto, courriel, partage): node --experimental-strip-types tests/message.test.ts
import assert from 'node:assert/strict';
import { clientDocMessage, firstName, greeting, isEvening } from '../src/lib/docLang.ts';

const soir = new Date(2026, 10, 3, 19, 30);
const jour = new Date(2026, 10, 3, 10, 0);
const base = { client: { name: 'Léo Gagnon', contact: '' }, company: 'Groupe Murco', owner: 'Samuel Michea', lang: 'fr' as const, job: 'Calfeutrage' };

// L'exemple de Sam, le soir
assert.equal(clientDocMessage({ ...base, kind: 'quote', now: soir, link: 'https://x/p/abc' }), [
  'Bonsoir Léo, voici la soumission pour vos travaux de calfeutrage.',
  'Vous pouvez la consulter et l’accepter en ligne : https://x/p/abc',
  '',
  'N’hésitez pas si vous avez des questions !',
  '',
  'Merci et bonne soirée,',
  'Groupe Murco',
].join('\n'));
// Le jour, une facture, sans lien (partage)
assert.equal(clientDocMessage({ ...base, kind: 'invoice', now: jour, job: 'Isolation de l’entretoit' }), [
  'Bonjour Léo, voici la facture pour vos travaux d’isolation de l’entretoit.',
  'Vous pouvez la consulter et la payer en ligne.',
  '',
  'N’hésitez pas si vous avez des questions !',
  '',
  'Merci et bonne journée,',
  'Groupe Murco',
].join('\n'));
assert.match(clientDocMessage({ ...base, kind: 'quote', now: jour, job: 'Travaux de toiture' }), /^Bonjour Léo, voici la soumission pour vos travaux de toiture\./);
assert.match(clientDocMessage({ ...base, kind: 'quote', now: jour, job: '', client: undefined }), /^Bonjour, voici la soumission\./);
assert.match(clientDocMessage({ ...base, kind: 'quote', lang: 'en', now: soir, link: 'https://x' }), /^Good evening Léo, here is the quote for your calfeutrage work\.\nYou can view and accept it online: https:\/\/x\n[\s\S]*have a great evening,\nGroupe Murco$/);
// Bonsoir à partir de 17 h, et la nuit
assert.equal(isEvening(new Date(2026, 0, 1, 16, 59)), false);
assert.equal(isEvening(new Date(2026, 0, 1, 17, 0)), true);
assert.equal(isEvening(new Date(2026, 0, 1, 2, 0)), true);
assert.equal(greeting('fr', jour), 'Bonjour');
assert.equal(firstName({ name: 'Mme Louise Roy', contact: '' }), 'Louise');
assert.equal(firstName({ name: 'Résidence Les Pins', contact: 'Paul Gagnon' }), 'Paul');
console.log('message au client: 11 cas OK');
