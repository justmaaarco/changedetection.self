import { DurableObject } from 'cloudflare:workers';
import { alertChannels, testAlert } from './alerts.mjs';
import { notifyRestocks } from './restock.mjs';
import { EE, PRIMARY, SUPPLEMENT, readOffers } from './offers.mjs';

const sources = [
  ['stockcheckers', PRIMARY],
  ['stock-checker', SUPPLEMENT],
  ['ee', EE],
];

async function checkSource([name, url]) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { name, offers: [], error: `HTTP ${response.status}` };
    }
    return { name, offers: readOffers(url, await response.text()) };
  } catch {
    return { name, offers: [], error: 'Fetch or parsing failed' };
  }
}

export class RestockMonitor extends DurableObject {
  #running;

  async check() {
    this.#running ??= this.#checkOnce();
    try {
      return await this.#running;
    } finally {
      this.#running = undefined;
    }
  }

  async #checkOnce() {
    const results = await Promise.all(sources.map(checkSource));
    // The direct EE page takes priority when available. The supplemental
    // feed covers the same product when EE declines the Worker request.
    const offers = [...new Map(results.flatMap(result =>
      result.offers.map(offer => [offer.url, offer])
    )).values()];
    const channels = alertChannels(this.env);
    const alerts = await notifyRestocks(this.ctx.storage, offers, channels, this.env.SIGN_IN_SHORTCUTS);
    const test = await testAlert(this.ctx.storage, this.env.ALERT_TEST, channels);
    return {
      listings: offers.length,
      sources: Object.fromEntries(results.map(({ name, offers, error }) => [name, error ?? offers.length])),
      channels: channels.map(([name]) => name),
      ...alerts,
      ...(test && { test }),
    };
  }
}

export default {
  async scheduled(_event, env) {
    const result = await env.MONITOR.getByName('uk').check();
    console.log('PS5 Pro stock check', result);
  },
};
