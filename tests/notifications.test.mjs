import assert from 'node:assert/strict';
import { test } from 'node:test';
import { __testing } from '../functions/api/notifications.js';

const {
  addDaysISO,
  buildReminderItems,
  buildEmailSubject,
  buildEmailText,
  filterUnsentItems,
  sentKeyForItem,
  validateNotificationAuth
} = __testing;

test('addDaysISO validates YYYY-MM-DD dates before adding days', () => {
  assert.equal(addDaysISO('2026-06-13', 2), '2026-06-15');
  assert.equal(addDaysISO('2026-02-30', 2), '');
  assert.equal(addDaysISO('2026-99-99', 2), '');
  assert.equal(addDaysISO('not-a-date', 2), '');
});

test('buildReminderItems includes only unpaid items due exactly two days later', () => {
  const data = {
    houses: [{ id: 'h1', nickname: 'Beach House' }],
    utilities: [
      { id: 'u1', houseId: 'h1', type: 'Electric', provider: 'FPL', amount: 123.45, due: '2026-06-15', paid: 'unpaid' },
      { id: 'u2', houseId: 'h1', type: 'Water', provider: 'City', amount: 50, due: '2026-06-15', paid: 'paid' }
    ],
    finance: [{
      houseId: 'h1',
      mortgageVisible: 'yes',
      mortgageDueDay: 15,
      mortgagePaid: 'paid',
      mortgagePaidDate: '2026-05-01',
      mortgageCompany: 'Bank',
      mortgageAmount: 2000
    }],
    financeItems: [
      { id: 'f1', houseId: 'h1', name: 'HOA', company: 'HOA Co', amount: 250, due: '2026-06-15', paid: 'unpaid' }
    ],
    creditCards: [
      { id: 'c1', bank: 'Chase', name: 'Sapphire', last4: '1234', dueDate: 'Jun 15', annualFee: 95, status: 'open' },
      { id: 'c2', bank: 'Closed', name: 'Card', last4: '9999', dueDate: 'Jun 15', annualFee: 95, status: 'closed' }
    ]
  };

  const items = buildReminderItems(data, '2026-06-13');
  assert.deepEqual(items.map(item => `${item.category}:${item.title}`), [
    'Utility:Electric',
    'Finance:Mortgage',
    'Finance:HOA',
    'Credit card:Chase Sapphire'
  ]);
});

test('email subject and text summarize utility, finance, and credit card reminders', () => {
  const items = [
    { category: 'Utility', title: 'Electric', subtitle: 'Beach House', amount: 123.45, dueDate: '2026-06-15' },
    { category: 'Finance', title: 'HOA', subtitle: '', amount: 250, dueDate: '2026-06-15' },
    { category: 'Credit card', title: 'Chase Sapphire', subtitle: '•••• 1234', amount: 95, dueDate: '2026-06-15' }
  ];

  assert.equal(buildEmailSubject(items, '2026-06-15'), 'Reminder: 1 utility bill and 1 finance item and 1 credit card due date due Jun 15, 2026');
  const text = buildEmailText(items, '2026-06-15');
  assert.match(text, /Utilities Tracker reminder/);
  assert.match(text, /Electric/);
  assert.match(text, /Chase Sapphire/);
});

test('filterUnsentItems skips items already sent to every recipient', async () => {
  const recipients = [{ email: 'a@example.com' }, { email: 'b@example.com' }];
  const sent = new Set();
  const kv = {
    async get(key) { return sent.has(key) ? 'sent' : null; }
  };
  const item = { id: 'u1', category: 'Utility', dueDate: '2026-06-15' };

  assert.deepEqual(await filterUnsentItems({ TRACKER_BACKUPS: kv }, [item], recipients), [item]);
  recipients.forEach(recipient => sent.add(sentKeyForItem(item, recipient.email)));
  assert.deepEqual(await filterUnsentItems({ TRACKER_BACKUPS: kv }, [item], recipients), []);
  assert.deepEqual(await filterUnsentItems({ TRACKER_BACKUPS: kv }, [item], recipients, true), [item]);
});

test('validateNotificationAuth accepts bearer and rejects missing or mismatched secrets', () => {
  assert.equal(validateNotificationAuth(new Request('https://example.com'), {}).status, 500);
  assert.equal(validateNotificationAuth(new Request('https://example.com'), { NOTIFICATION_SECRET: 'secret' }).status, 401);
  assert.equal(validateNotificationAuth(new Request('https://example.com', { headers: { Authorization: 'Bearer wrong' } }), { NOTIFICATION_SECRET: 'secret' }).status, 401);
  assert.deepEqual(validateNotificationAuth(new Request('https://example.com', { headers: { Authorization: 'Bearer secret' } }), { NOTIFICATION_SECRET: 'secret' }), { ok: true });
});
