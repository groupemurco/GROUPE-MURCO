// node --experimental-strip-types tests/billing.test.ts
import assert from 'node:assert/strict';
import { billingState } from '../src/lib/billingState.ts';

const base = { foundersBefore: '2026-10-05T00:00:00Z', trialDays: 14, now: new Date('2026-11-01T12:00:00Z') };
assert.equal(billingState({ ...base, signedIn: false }).kind, 'local');
assert.equal(billingState({ ...base, signedIn: true, accountCreatedAt: '2026-09-01T00:00:00Z' }).kind, 'founder');
const t = billingState({ ...base, signedIn: true, accountCreatedAt: '2026-10-25T12:00:00Z' });
assert.equal(t.kind, 'trial');
assert.equal(t.daysLeft, 7);
const x = billingState({ ...base, signedIn: true, accountCreatedAt: '2026-10-10T00:00:00Z' });
assert.equal(x.kind, 'expired');
assert.equal(x.canWrite, false);
const a = billingState({ ...base, signedIn: true, accountCreatedAt: '2026-10-10T00:00:00Z', record: { status: 'active', plan: 'equipe', currentPeriodEnd: '2026-11-10T12:00:00Z' } });
assert.equal(a.kind, 'active');
assert.equal(a.plan, 'equipe');
assert.equal(a.daysLeft, 9);
assert.equal(billingState({ ...base, signedIn: true, accountCreatedAt: '2026-10-10T00:00:00Z', record: { status: 'past_due' } }).canWrite, true);
assert.equal(billingState({ ...base, signedIn: true, accountCreatedAt: '2026-10-10T00:00:00Z', record: { status: 'canceled' } }).kind, 'expired');
// Compte du créateur (ou son entreprise): toujours fondateur, même créé après la date des fondateurs
const owner = { ...base, signedIn: true, foundersBefore: '2999-01-01T00:00:00Z' };
assert.equal(billingState({ ...owner, accountCreatedAt: '2026-10-25T12:00:00Z' }).kind, 'founder');
assert.equal(billingState({ ...owner, accountCreatedAt: '2026-10-10T00:00:00Z' }).canWrite, true);
console.log('abonnement (app): 13 cas OK');
