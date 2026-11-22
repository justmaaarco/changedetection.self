import { CAP } from './offers.mjs';
import { alertText } from './alerts.mjs';

export async function notifyRestocks(storage, offers, channels, signInShortcuts) {
  const delivered = await storage.get('delivered') ?? {};
  const eligible = [];
  for (const offer of offers) {
    if (offer.status === 'unknown') continue;
    if (offer.status !== 'in stock' || offer.price > CAP) {
      delete delivered[offer.url];
    } else {
      eligible.push(offer);
    }
  }
  // Persist sellouts even if a provider is down. Retry failed deliveries only
  // while a fresh observation still shows qualifying stock.
  await storage.put('delivered', delivered);
  eligible.sort((first, second) => first.price - second.price);
  const sent = [];
  const failed = [];
  for (const [channel, send] of channels) {
    const pending = eligible.filter(({ url }) => !delivered[url]?.includes(channel));
    if (!pending.length) continue;
    try {
      // Keep SMS to the stock and product link. Extra URLs can add paid segments.
      await send(alertText(pending, channel === 'sms' ? '' : signInShortcuts));
    } catch {
      failed.push(channel);
      continue;
    }
    for (const { url } of pending) (delivered[url] ??= []).push(channel);
    await storage.put('delivered', delivered);
    sent.push(channel);
  }
  return { eligible: eligible.length, sent, failed };
}
