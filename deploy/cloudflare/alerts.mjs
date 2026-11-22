const subject = 'PS5 Pro restock at £789.99 or less';
const pounds = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export function alertText(offers) {
  return offers.map(({ retailer, price, url }) =>
    `PS5 Pro in stock at ${retailer} for ${pounds.format(price / 100)}\n${url}`
  ).join('\n\n');
}

async function sendRequest(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Notification returned HTTP ${response.status}`);
  }
  await response.body?.cancel();
}

export function alertChannels(env) {
  const channels = [];
  if (env.EMAIL && env.ALERT_EMAIL_FROM && env.ALERT_EMAIL_TO) {
    channels.push(['email', (text) => env.EMAIL.send({
      from: env.ALERT_EMAIL_FROM, to: env.ALERT_EMAIL_TO, subject, text,
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
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM && env.ALERT_SMS_TO) {
    const credentials = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    channels.push(['sms', (text) => sendRequest(endpoint, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}` },
      body: new URLSearchParams({ From: env.TWILIO_FROM, To: env.ALERT_SMS_TO, Body: text }),
    })]);
  }
  return channels;
}
