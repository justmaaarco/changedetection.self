import { PLAYSTATION } from './offers.mjs';

const subject = 'PS5 Pro restock at £789.99 or less';
const pounds = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const signInLinks = new Map(Object.entries({
  'PlayStation Direct': ['playstation', 'https://www.playstation.com/acct/management'],
  Argos: ['argos', 'https://www.argos.co.uk/account/login'],
  'John Lewis': ['john-lewis', 'https://www.johnlewis.com/my-account'],
  Smyths: ['smyths', 'https://www.smythstoys.com/uk/en-gb/login'],
}));

export function alertText(offers, signInShortcuts) {
  const preferences = typeof signInShortcuts === 'string' ? signInShortcuts.split(',') : [];
  const selected = new Set(preferences.map(value => value.trim().toLowerCase()));
  return offers.map(({ retailer, price, url }) => {
    const lines = [`PS5 Pro in stock at ${retailer} for ${pounds.format(price / 100)}`, url];
    const shortcut = signInLinks.get(retailer);
    if (shortcut && selected.has(shortcut[0])) lines.push(`Retailer account: ${shortcut[1]}`);
    return lines.join('\n');
  }).join('\n\n');
}

class NotificationHttpError extends Error {
  constructor(status) {
    super(`Notification returned HTTP ${status}`);
    this.status = status;
  }
}

async function sendRequest(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000), redirect: 'manual' });
  await response.body?.cancel().catch(() => {});
  if (!response.ok) {
    throw new NotificationHttpError(response.status);
  }
}

export function alertChannels(env) {
  const channels = [];
  if (env.RESEND_API_KEY && env.RESEND_FROM && env.ALERT_EMAIL_TO) {
    channels.push(['email', (text, title = subject) => sendRequest('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PS5 Restock Tracker',
        Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`,
      },
      body: JSON.stringify({ from: env.RESEND_FROM.trim(), to: [env.ALERT_EMAIL_TO.trim()], subject: title, text }),
    })]);
  } else if (env.EMAIL && env.ALERT_EMAIL_FROM && env.ALERT_EMAIL_TO) {
    channels.push(['email', (text, title = subject) => env.EMAIL.send({
      from: env.ALERT_EMAIL_FROM, to: env.ALERT_EMAIL_TO, subject: title, text,
    })]);
  }
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const endpoint = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    channels.push(['telegram', (text) => sendRequest(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, link_preview_options: { is_disabled: true } }),
    })]);
  }
  const apiKeyConfigured = env.TWILIO_API_KEY_SID || env.TWILIO_API_KEY_SECRET;
  const smsUser = apiKeyConfigured ? env.TWILIO_API_KEY_SID : env.TWILIO_ACCOUNT_SID;
  const smsSecret = apiKeyConfigured ? env.TWILIO_API_KEY_SECRET : env.TWILIO_AUTH_TOKEN;
  if (env.TWILIO_ACCOUNT_SID && smsUser && smsSecret && env.TWILIO_FROM && env.ALERT_SMS_TO) {
    const credentials = btoa(`${smsUser}:${smsSecret}`);
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    channels.push(['sms', (text) => sendRequest(endpoint, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}` },
      body: new URLSearchParams({ From: env.TWILIO_FROM, To: env.ALERT_SMS_TO, Body: text }),
    })]);
  }
  return channels;
}

export async function testAlert(storage, request, channels) {
  if (!request) return undefined;
  const match = typeof request === 'string' && /^(email|sms|telegram):([a-z0-9_-]{1,40})$/i.exec(request.trim());
  if (!match) return { status: 'invalid request' };
  const [, requestedChannel, id] = match;
  const channel = requestedChannel.toLowerCase();
  const send = channels.find(([name]) => name === channel)?.[1];
  if (!send) return { channel, status: 'not configured' };

  const key = `alert-test:${channel}`;
  if (await storage.get(key) === id) return undefined;
  // Record the attempt before sending so a repeated cron event cannot resend it.
  await storage.put(key, id);
  try {
    await send(`PS5 Pro alert test. No restock detected by this test.\n${PLAYSTATION}`, 'PS5 Pro alert test');
    return { channel, status: 'accepted by provider' };
  } catch (error) {
    if (error instanceof NotificationHttpError) {
      return { channel, status: 'delivery failed', httpStatus: error.status };
    }
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return { channel, status: 'delivery failed', reason: 'request timed out' };
    }
    if (error?.name === 'TypeError') {
      const reason = /headers?/i.test(error.message) ? 'invalid request headers' : 'request could not connect';
      return { channel, status: 'delivery failed', reason };
    }
    return { channel, status: 'delivery failed' };
  }
}
