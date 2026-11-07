// Devis détaillé: node --experimental-strip-types tests/devis.test.ts
import assert from 'node:assert/strict';
import {
  blankDevis, cleanItem, contactFromText, devisFromJson, devisFromTemplate, devisFromText, devisLineDescription, devisTitle, estimateTotal, isDevisEmpty, itemCount,
  priceFromEstimate, sectionTotalText, parseTarif, splitIncludedTaxes, tarifNote, templateKeyFor, templateKeyForText, withoutContact, type Devis, type PriceRef,
} from '../src/lib/devis.ts';

// L'exemple de Groupe Murco: 5 + 8 + 1 + 1 = 15 ouvertures
const calf: Devis = { ...devisFromTemplate('calfeutrage') };
calf.sections = [{ ...calf.sections[0], items: ['5 fenêtres au sous-sol', '8 fenêtres au rez-de-chaussée', '1 porte d’entrée', '1 porte-patio'] }, ...calf.sections.slice(1)];
assert.equal(sectionTotalText(calf.sections[0]), 'Total : 15 ouvertures');
assert.equal(sectionTotalText(calf.sections[1]), ''); // les travaux inclus ne se comptent pas
assert.equal(devisTitle('Groupe Murco', calf), 'SOUMISSION DE CALFEUTRAGE'); // le nom de l'entreprise est déjà en haut de la feuille
assert.equal(devisLineDescription(calf), 'Calfeutrage (15 ouvertures) — prix forfaitaire');

// Rien de pré-écrit: les modèles n'ont pas d'éléments visés, un devis neuf est vide
for (const k of ['calfeutrage', 'peinture', 'exterieur', 'deneigement', 'paysagement', 'menage', 'toiture', 'general']) {
  assert.equal(devisFromTemplate(k).sections[0].items.length, 0, k);
}
assert.equal(isDevisEmpty(blankDevis()), true);
assert.equal(isDevisEmpty(calf), false);
assert.equal(devisLineDescription(blankDevis()), 'Travaux — prix forfaitaire');

// Points: puces enlevées, nombres comptés, sans nombre = 1
assert.equal(cleanItem('• 5 fenêtres au sous-sol'), '5 fenêtres au sous-sol');
assert.equal(cleanItem('- Porte-patio'), 'Porte-patio');
assert.equal(cleanItem('2) chambres'), 'chambres');
assert.equal(itemCount('• 8 fenêtres au rez-de-chaussée'), 8);
assert.equal(itemCount('Porte-patio'), 1);
assert.equal(itemCount('2,5 heures'), 2.5);
assert.equal(sectionTotalText({ title: 'x', items: ['', '  ', '3 portes'], countLabel: 'ouvertures' }), 'Total : 3 ouvertures');

// Taxes incluses: le total reste exactement le prix demandé
for (const gross of [1650, 99.99, 1000, 12345.67, 0.5]) {
  const t = splitIncludedTaxes(gross, 5, 9.975, true, true);
  assert.equal(Math.round((t.subtotal + t.tps + t.tvq) * 100) / 100, gross, `total ${gross}`);
}
assert.deepEqual(splitIncludedTaxes(1650, 5, 9.975, true, true), { subtotal: 1435.1, tps: 71.75, tvq: 143.15 });
assert.deepEqual(splitIncludedTaxes(1650, 5, 9.975, false, false), { subtotal: 1650, tps: 0, tvq: 0 });

// Modèle selon le métier; les copies sont indépendantes
assert.equal(templateKeyFor(['calfeutrage', 'peinture']), 'calfeutrage');
assert.equal(templateKeyFor(['arboriculture']), 'paysagement');
assert.equal(templateKeyFor(['informatique']), 'general');
const a = devisFromTemplate('calfeutrage');
a.sections[0].items.push('1 porte de garage');
assert.equal(devisFromTemplate('calfeutrage').sections[0].items.length, 0);
const mine = devisFromTemplate('perso:Calfeutrage brique', [{ name: 'Calfeutrage brique', devis: { ...a, heading: 'Calfeutrage de brique' } }]);
assert.equal(mine.heading, 'Calfeutrage de brique');

// Réponse de l'IA: on garde ce qui est valide, le reste vient du modèle; le client et les questions suivent
const ai = devisFromJson({
  titre: 'Soumission de calfeutrage', sections: [{ titre: 'Ouvertures visées', points: ['6 fenêtres', '1 porte'], compter: 'ouvertures' }, { titre: '', points: [] }],
  prix: '1200', taxes_incluses: true, adresse: '12 rue X', courriel_client: true, questions: ['Couleur du scellant?', ''],
  client: { nom: 'Denise Tremblay', courriel: 'Denise@Exemple.com', telephone: '819-555-0101', adresse: '12 rue X' },
}, calf);
assert.equal(ai.devis.sections.length, 1);
assert.equal(sectionTotalText(ai.devis.sections[0]), 'Total : 7 ouvertures');
assert.equal(ai.price, 1200);
assert.equal(ai.taxIncluded, true);
assert.equal(ai.address, '12 rue X');
assert.deepEqual(ai.devis.conditions, calf.conditions);
assert.deepEqual(ai.client, { name: 'Denise Tremblay', contact: undefined, email: 'denise@exemple.com', phone: '819-555-0101', address: '12 rue X' });
assert.equal(ai.fromClient, true);
assert.deepEqual(ai.questions, ['Couleur du scellant?']);
assert.equal(devisFromJson(null, calf).devis.heading, calf.heading);
assert.equal(devisFromJson(null, calf).client, undefined);

// Sans IA: les morceaux de la phrase deviennent les points, le prix et les taxes sont repérés
const quick = devisFromText('5 fenêtres au sous-sol, 8 fenêtres au rez-de-chaussée, 1 porte d’entrée et 1 porte-patio, 1 650 $ taxes incluses', devisFromTemplate('calfeutrage'));
assert.deepEqual(quick.devis.sections[0].items, ['5 fenêtres au sous-sol', '8 fenêtres au rez-de-chaussée', '1 porte d’entrée', '1 porte-patio']);
assert.equal(sectionTotalText(quick.devis.sections[0]), 'Total : 15 ouvertures');
assert.equal(quick.price, 1650);
assert.equal(quick.taxIncluded, true);
assert.equal(quick.devis.sections[1].items.length, 5); // travaux inclus du modèle gardés
assert.equal(devisFromText('3 fenêtres 900$ plus taxes', calf).taxIncluded, false);

// Sans IA, un courriel transféré: les coordonnées du client, pas les miennes
const mail = `---------- Forwarded message ---------
De : Samuel Michea <info@groupemurco.com>
De : Denise Tremblay <denise.t@exemple.com>
Objet : Soumission calfeutrage
Bonjour, j'aimerais une soumission pour mes fenêtres. Mon numéro: 819 555-0101.
Merci! Groupe Murco 514-232-1837`;
assert.deepEqual(contactFromText(mail, { email: 'info@groupemurco.com', phone: '514-232-1837' }), { name: 'Denise Tremblay', email: 'denise.t@exemple.com', phone: '819 555-0101' });
assert.deepEqual(contactFromText('appelle-moi au (450) 555-1234 ou jo@x.ca'), { name: undefined, email: 'jo@x.ca', phone: '(450) 555-1234' });

// Prix estimé: les lignes de l'IA prennent MES prix quand le code existe (minimum compris), le reste garde son prix
const prices: PriceRef[] = [
  { code: 'CAF', name: 'Calfeutrage du contour des fenêtres et portes', unit: 'fenêtre', price: 65, minimum: 150 },
  { code: 'CAR', name: 'Arrachage de l’ancien calfeutrage', unit: 'pi lin', price: 1.5 },
];
const est = devisFromJson({
  titre: 'Soumission de calfeutrage', prix: 0,
  estimation: [
    { code: 'caf', description: '16 ouvertures (fenêtres et porte de garage)', quantite: 16, unite: 'fenêtre', prix_unitaire: 999 },
    { code: '', description: 'Porte de garage (grand contour, estimé)', quantite: 1, unite: 'unité', prix_unitaire: 120 },
    { code: 'XYZ', description: '', quantite: 2, prix_unitaire: 50 },
    { code: '', description: 'Rien', quantite: 1, prix_unitaire: 0 },
  ],
  explication_prix: '16 ouvertures selon le courriel.',
}, calf, prices);
assert.equal(est.price, undefined); // pas de prix donné par le client
assert.equal(est.estimate!.lines.length, 2);
assert.deepEqual(est.estimate!.lines[0], { code: 'CAF', description: '16 ouvertures (fenêtres et porte de garage)', unit: 'fenêtre', quantity: 16, unitPrice: 65, minimum: 150 });
assert.equal(est.estimate!.lines[1].code, '');
assert.equal(estimateTotal(est.estimate!.lines), 1160); // 16 × 65 + 120
assert.equal(est.estimate!.note, '16 ouvertures selon le courriel.');
assert.equal(estimateTotal([{ code: 'CAF', description: 'x', quantity: 1, unitPrice: 65, minimum: 150 }]), 150); // minimum de la ligne
assert.equal(priceFromEstimate(1160, { taxed: false, tpsRate: 5, tvqRate: 9.975 }), 1160);
assert.equal(priceFromEstimate(1161, { taxed: false, tpsRate: 5, tvqRate: 9.975 }), 1165); // arrondi aux 5 $
assert.equal(priceFromEstimate(1000, { taxIncluded: true, taxed: true, tpsRate: 5, tvqRate: 9.975 }), 1150); // 1149,75 avec taxes
assert.equal(priceFromEstimate(1000, { taxIncluded: false, taxed: true, tpsRate: 5, tvqRate: 9.975 }), 1000);
assert.equal(devisFromJson({ estimation: 'non' }, calf, prices).estimate, undefined);

// Sans IA, une phrase: le nom, le téléphone et l'adresse deviennent le client; le reste devient la job
const phrase = 'Denise Tremblay 819 555-0101, 45 rue des Pins à Magog. Calfeutrage de 6 fenêtres au sous-sol, 9 au rez-de-chaussée et la porte de garage.';
const pc = contactFromText(phrase);
assert.deepEqual(pc, { name: 'Denise Tremblay', email: undefined, phone: '819 555-0101', address: '45 rue des Pins, Magog' });
assert.equal(withoutContact(phrase, pc), 'Calfeutrage de 6 fenêtres au sous-sol, 9 au rez-de-chaussée et la porte de garage');
assert.equal(templateKeyForText(phrase), 'calfeutrage');
const p2 = 'Pour Jean-Guy Roy, 450-555-1212, 1200 boulevard Saint-Joseph, Drummondville, QC J2B 1A1: peinture du salon et 2 chambres';
assert.deepEqual(contactFromText(p2), { name: 'Jean-Guy Roy', email: undefined, phone: '450-555-1212', address: '1200 boulevard Saint-Joseph, Drummondville, QC J2B 1A1' });
assert.equal(withoutContact(p2, contactFromText(p2)), 'peinture du salon et 2 chambres');
assert.equal(templateKeyForText(p2), 'peinture');
assert.equal(contactFromText('calfeutrage 12 fenêtres chez Marc Lévesque 418 555 0000').name, 'Marc Lévesque');
assert.equal(templateKeyForText('installer un spa'), undefined);
const sansIa = devisFromText(withoutContact(phrase, pc), devisFromTemplate('calfeutrage'));
assert.equal(sectionTotalText(sansIa.devis.sections[0]), 'Total : 16 ouvertures'); // 6 + 9 + la porte (1)

// Tarif dit par le patron: 75 pieds linéaires à 6 $ du pied
assert.deepEqual(parseTarif('caulking couleur stone, 75 pi lin a 6$ du pied linaire'), { qty: 75, rate: 6 });
assert.deepEqual(parseTarif('75 pieds linéaires à 6,50 $ le pied'), { qty: 75, rate: 6.5 });
assert.deepEqual(parseTarif('calfeutrage 75 pi lin a 6$ pied lineaire pour M Crete'), { qty: 75, rate: 6 });
assert.deepEqual(parseTarif('75 pieds linéaires, 6 $/pi'), { qty: 75, rate: 6 });
assert.equal(parseTarif('2 fenêtres et 1 porte, 450 $'), null);
assert.equal(tarifNote({ qty: 75, rate: 6 }), 'Tarif : 6,00 $ par pied linéaire. Base de calcul : 75 pieds linéaires.');

console.log('devis: 72 cas OK');
