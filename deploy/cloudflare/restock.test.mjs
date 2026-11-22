import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EE, PLAYSTATION, PRIMARY, SUPPLEMENT, readOffers } from './offers.mjs';
import { notifyRestocks } from './restock.mjs';
import { alertChannels, alertText, testAlert } from './alerts.mjs';

test('uses the exact product link and excludes refurbished and bundled offers', () => {
  const product = 'https://direct.playstation.com/en-gb/buy-consoles/playstation5-pro-console-2-tb';
  const row = title => `<tr><td data-label="Store">PlayStation Direct</td>
    <td data-label="Product"><a href="${product}">${title}</a></td>
    <td data-label="Price">&pound;789.99</td><td data-label="">In Stock</td></tr>`;
  assert.deepEqual(readOffers(PRIMARY, row('PlayStation®5 Pro 2 TB') + row('PS5 Pro console bundle')), [{
    retailer: 'PlayStation Direct', url: 'https://www.playstation.com/en-gb/ps5/ps5-pro/buy-now/?productCode=1000050928-GB',
    price: 78999, status: 'in stock',
  }]);
  assert.throws(() => readOffers(PRIMARY, row('PS5 Pro refurbished')));
});

test('recognizes additional retailers and uses the direct EE listing', () => {
  const box = 'https://box.co.uk/p5hehwsny59577-sony-playstation-5-pro-console';
  const tracked = `https://www.awin1.com/cread.php?awinmid=12345&amp;ued=${encodeURIComponent(box)}`;
  const row = `<tr><td>Box</td><td>Sony PlayStation 5 Pro Console</td><td>£609.99</td>
    <td></td><td><a href="${tracked}">In Stock</a></td></tr>`;
  assert.deepEqual(readOffers(SUPPLEMENT, row), [{ retailer: 'Box', url: box, price: 60999, status: 'in stock' }]);
  assert.deepEqual(readOffers(SUPPLEMENT, row.replace(tracked, EE)), [
    { retailer: 'EE Store', url: EE, price: 60999, status: 'in stock' },
  ]);
  const structured = JSON.stringify({
    '@type': 'Product', mpn: '1000050725',
    offers: { url: EE, priceCurrency: 'GBP', price: '789.99', availability: 'https://schema.org/OutOfStock' },
  });
  assert.equal(readOffers(EE, `<script type="application/ld+json">${structured}</script>`)[0].status, 'out of stock');
});

test('applies the cap, retries individual failed channels and rearms after sellout', async () => {
  const offer = { retailer: 'Box', url: 'https://box.co.uk/example', price: 78999, status: 'in stock' };
  const values = new Map();
  const storage = {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); },
  };
  const received = [];
  let smsDown = true;
  const channels = [
    ['email', async text => received.push(text)],
    ['sms', async () => { if (smsDown) throw new Error('Unavailable'); }],
  ];
  assert.equal((await notifyRestocks(storage, [{ ...offer, price: 79000 }], channels)).eligible, 0);
  assert.deepEqual((await notifyRestocks(storage, [offer], channels)).failed, ['sms']);
  assert.match(received[0], /Box for £789\.99\nhttps:\/\/box\.co\.uk\/example/);
  smsDown = false;
  assert.deepEqual((await notifyRestocks(storage, [offer], channels)).sent, ['sms']);
  await notifyRestocks(storage, [{ ...offer, status: 'unknown' }], channels);
  assert.deepEqual((await notifyRestocks(storage, [offer], channels)).sent, []);
  await notifyRestocks(storage, [{ ...offer, status: 'out of stock' }], channels);
  assert.deepEqual((await notifyRestocks(storage, [offer], channels)).sent, ['email', 'sms']);
});

test('only uses completed delivery configurations', () => {
  assert.deepEqual(alertChannels({ ALERT_EMAIL_TO: 'reader@example.com', ALERT_SMS_TO: '+12025550110' }), []);
  assert.deepEqual(alertChannels({
    EMAIL: {}, ALERT_EMAIL_FROM: 'alerts@example.com', ALERT_EMAIL_TO: 'reader@example.com',
    TELEGRAM_BOT_TOKEN: 'fixture', TELEGRAM_CHAT_ID: 'fixture',
    TWILIO_ACCOUNT_SID: 'fixture', TWILIO_AUTH_TOKEN: 'fixture',
    TWILIO_FROM: '+12025550111', ALERT_SMS_TO: '+12025550110',
  }).map(([channel]) => channel), ['email', 'telegram', 'sms']);
});

test('includes the selected first-party account link in email and keeps the SMS short', async () => {
  const offer = { retailer: 'PlayStation Direct', price: 78999, status: 'in stock', url: PLAYSTATION };
  const messages = {};
  const channels = [
    ['email', async text => { messages.email = text; }],
    ['sms', async text => { messages.sms = text; }],
  ];
  const saved = new Map();
  await notifyRestocks({ get: key => saved.get(key), put: (key, value) => saved.set(key, value) },
    [offer], channels, 'argos, PlayStation, https://example.com');
  assert.ok(messages.email.endsWith('Retailer account: https://www.playstation.com/acct/management'));
  assert.ok(messages.sms.endsWith(PLAYSTATION));
  assert.equal(alertText([offer], 'argos'), messages.sms);
});

test('sends a test through Resend and keeps one email route when both senders are configured', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 200 }));
  const nativeSend = t.mock.fn();
  const settings = {
    RESEND_API_KEY: 'test-sending-key', RESEND_FROM: 'PS5 Alerts <alerts@example.com>',
    ALERT_EMAIL_TO: 'reader@example.com', ALERT_EMAIL_FROM: 'native@example.com',
    EMAIL: { send: nativeSend },
  };
  const channels = alertChannels(settings);
  assert.deepEqual(channels.map(([name]) => name), ['email']);
  const saved = new Map();
  const storage = { get: key => saved.get(key), put: (key, value) => saved.set(key, value) };
  assert.deepEqual(await testAlert(storage, 'email:resend-test', channels), { channel: 'email', status: 'accepted by provider' });
  const [[url, options]] = fetchMock.mock.calls.map(call => call.arguments);
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(options.headers.Authorization, 'Bearer test-sending-key');
  assert.deepEqual(JSON.parse(options.body), {
    from: settings.RESEND_FROM, to: [settings.ALERT_EMAIL_TO], subject: 'PS5 Pro alert test',
    text: `PS5 Pro alert test. No restock detected by this test.\n${PLAYSTATION}`,
  });
  assert.equal(nativeSend.mock.callCount(), 0);
  await alertChannels({ ...settings, RESEND_API_KEY: undefined })[0][1]('Native test');
  assert.equal(nativeSend.mock.callCount(), 1);
});

test('uses a dedicated Twilio API key and the configured account and phone numbers', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 201 }));
  const settings = {
    TWILIO_ACCOUNT_SID: 'ACfixture', TWILIO_FROM: '+12025550110', ALERT_SMS_TO: '+12025550111',
    TWILIO_API_KEY_SID: 'SKfixture', TWILIO_AUTH_TOKEN: 'legacy-fixture',
  };
  assert.deepEqual(alertChannels(settings), []);
  const [[name, send]] = alertChannels({ ...settings, TWILIO_API_KEY_SECRET: 'new-fixture' });
  assert.equal(name, 'sms');
  await send('Restock alert');
  const [[url, options]] = fetchMock.mock.calls.map(call => call.arguments);
  assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/ACfixture/Messages.json');
  assert.equal(options.headers.Authorization, `Basic ${btoa('SKfixture:new-fixture')}`);
  assert.equal(options.body.get('To'), '+12025550111');
});

test('a private test request tries only the selected channel once', async () => {
  const saved = new Map();
  const storage = { get: key => saved.get(key), put: (key, value) => saved.set(key, value) };
  const messages = [];
  const channels = [
    ['email', async (text, title) => messages.push({ text, title })],
    ['sms', async () => { throw new Error('Provider or network error'); }],
  ];
  assert.deepEqual(await testAlert(storage, 'telegram:first', channels), { channel: 'telegram', status: 'not configured' });
  assert.deepEqual(await testAlert(storage, 'email:first', channels), { channel: 'email', status: 'accepted by provider' });
  assert.equal(await testAlert(storage, 'email:first', channels), undefined);
  assert.deepEqual(await testAlert(storage, 'sms:first', channels), { channel: 'sms', status: 'delivery failed' });
  assert.equal(await testAlert(storage, 'sms:first', channels), undefined);
  assert.deepEqual(messages, [{
    title: 'PS5 Pro alert test', text: `PS5 Pro alert test. No restock detected by this test.\n${PLAYSTATION}`,
  }]);
});
