import supplemental from '../../changedetectionio/processors/ps5_restock/supplement_listings.json' with { type: 'json' };

export const CAP = 78_999;
export const PRIMARY = 'https://www.stockcheckers.co.uk/sony/playstation/ps5/ps5-pro-console.php';
export const SUPPLEMENT = 'https://stock-checker.com/products/gaming/ps5-pro';
export const EE = 'https://ee.co.uk/products/ps5-pro-console-b-chassis';
export const PLAYSTATION = 'https://www.playstation.com/en-gb/ps5/ps5-pro/buy-now/?productCode=1000050928-GB';

const primaryRetailers = new Map(Object.entries({
  'ao.com': 'AO', 'amazon.co.uk': 'Amazon', 'currys.co.uk': 'Currys',
  'game.co.uk': 'GAME', 'direct.playstation.com': 'PlayStation Direct',
  'playstation.com': 'PlayStation Direct', 'shopto.net': 'ShopTo',
  'thegamecollection.net': 'The Game Collection', 'very.co.uk': 'Very',
}));
const affiliateParams = new Map(Object.entries({
  'awin1.com': 'ued', 'go.skimresources.com': 'url', 'jdoqocy.com': 'url',
  'redirect.viglink.com': 'out',
}));
const consoleName = /\b(?:ps\s*5|playstation\s*5?)\s+pro\b/i;
const excluded = /\b(?:bundle|anniversary|limited edition|renewed|refurbished|recertified|used|pre[- ]owned|open box|third[- ]party|marketplace|gift card|digital voucher|skin|case|cover|lease)\b/i;
const rows = /<tr\b[^>]*>(.*?)<\/tr\s*>/gis;
const link = /<a\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a\s*>/is;

const entities = { amp: '&', pound: '£', nbsp: ' ', reg: '', trade: '', quot: '"', apos: "'" };
function decode(markup) {
  return markup.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (original, entity) => {
    if (!entity.startsWith('#')) return Object.hasOwn(entities, entity) ? entities[entity] : original;
    const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point <= 0x10ffff ? String.fromCodePoint(point) : original;
  });
}

function cellText(markup) {
  return decode(markup.replace(/<[^>]*>/g, ' ')).replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
}

function pricePence(markup) {
  const match = /^£\s*(\d{1,5})(?:\.(\d{1,2}))?$/.exec(cellText(markup).replaceAll(',', ''));
  return match ? (Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))) || null : null;
}

function stockStatus(markup) {
  const status = cellText(markup).toLowerCase();
  return ['in stock', 'out of stock', 'pre-order'].includes(status) ? status : 'unknown';
}

function retailerLink(href) {
  let target = URL.parse(decode(href));
  if (target?.protocol !== 'https:') return null;
  let host = target.host.replace(/^www\./, '');
  if (affiliateParams.has(host)) {
    target = URL.parse(target.searchParams.get(affiliateParams.get(host)) ?? target.searchParams.get('u') ?? '');
  } else if (host === 'sonyps.prf.hn' || host === 'game.prf.hn') {
    const destination = target.pathname.split('/destination:')[1];
    if (!destination) return null;
    try {
      target = URL.parse(decodeURIComponent(destination));
    } catch {
      return null;
    }
  }
  if (target?.protocol !== 'https:' || target.pathname === '/') return null;
  if (target.username || target.password) return null;
  host = target.host.replace(/^www\./, '');
  const path = target.pathname.replace(/\/$/, '');
  if (host === 'ee.co.uk' && path === new URL(EE).pathname) return { retailer: 'EE Store', url: EE };
  if (Object.hasOwn(supplemental, host)) {
    const [retailer, url, suffix] = supplemental[host];
    return path.endsWith(suffix ?? new URL(url).pathname) ? { retailer, url } : null;
  }
  const retailer = primaryRetailers.get(host);
  if (!retailer) return null;
  if (retailer === 'PlayStation Direct') {
    const productCode = target.searchParams.get('productCode');
    const isDirect = host === 'direct.playstation.com' && path === '/en-gb/buy-consoles/playstation5-pro-console-2-tb';
    const isPlayStation = host === 'playstation.com' && path === '/en-gb/ps5/ps5-pro/buy-now'
      && (!productCode || productCode === '1000050928-GB');
    return isDirect || isPlayStation ? { retailer, url: PLAYSTATION } : null;
  }
  if (host === 'amazon.co.uk') {
    const asin = /\/dp\/([A-Z0-9]{10})(?:\/|$)/.exec(path)?.[1];
    return asin ? { retailer, url: `https://www.amazon.co.uk/dp/${asin}` } : null;
  }
  target.search = '';
  if (host !== 'game.co.uk' || !/^#colcode=\d+$/.test(target.hash)) target.hash = '';
  return { retailer, url: target.href };
}

function readFeed(source, html) {
  const offers = new Map();
  const primary = source === PRIMARY;
  for (const [, row] of html.matchAll(rows)) {
    const cells = primary
      ? Object.fromEntries(Array.from(row.matchAll(/<td\b[^>]*\sdata-label\s*=\s*["']([^"']*)["'][^>]*>(.*?)<\/td\s*>/gis),
          ([, name, content]) => [name.toLowerCase(), content]))
      : Array.from(row.matchAll(/<td\b[^>]*>(.*?)<\/td\s*>/gis), ([, content]) => content);
    if (primary ? !('store' in cells && 'product' in cells && 'price' in cells) : cells.length !== 5) continue;
    const product = primary ? cells.product : cells[1];
    const anchor = (primary ? product : cells[4]).match(link);
    const title = cellText(primary ? (anchor?.[2] ?? '') : product);
    const statusMarkup = primary ? (cells.stock ?? cells[''] ?? '') : (anchor?.[2] ?? '');
    if (!anchor || !consoleName.test(title) || excluded.test(cellText(product)) || excluded.test(cellText(statusMarkup))) continue;
    const destination = retailerLink(anchor[1]);
    const price = pricePence(primary ? cells.price : cells[2]);
    if (!destination || price === null) continue;
    const host = new URL(destination.url).host.replace(/^www\./, '');
    const isSupplemental = Object.hasOwn(supplemental, host) || destination.url === EE;
    if (primary === isSupplemental) continue;
    const status = stockStatus(statusMarkup);
    const old = offers.get(destination.url);
    if (old?.status === 'in stock' && (status !== 'in stock' || old.price <= price)) continue;
    offers.set(destination.url, { ...destination, price, status });
  }
  if (!offers.size) throw new Error('No recognized listings');
  return [...offers.values()];
}

function readEE(html) {
  const statuses = {
    InStock: 'in stock', OutOfStock: 'out of stock', SoldOut: 'out of stock',
    PreOrder: 'pre-order', PreSale: 'pre-order',
  };
  const offers = new Map();
  for (const [, text] of html.matchAll(/<script\b[^>]*\stype\s*=\s*["']application\/ld\+json["'][^>]*>(.*?)<\/script\s*>/gis)) {
    let product;
    try { product = JSON.parse(text); } catch { continue; }
    if (product?.['@type'] !== 'Product' || product.mpn !== '1000050725') continue;
    for (const offer of [product.offers].flat()) {
      if (offer?.url !== EE || offer.priceCurrency !== 'GBP') continue;
      if (offer.itemCondition && offer.itemCondition !== 'https://schema.org/NewCondition') continue;
      const status = statuses[String(offer.availability).replace(/^https:\/\/schema\.org\//, '')];
      const price = pricePence(`£${offer.price}`);
      if (typeof status === 'string' && price !== null) {
        offers.set(`${status}:${price}`, { retailer: 'EE Store', url: EE, price, status });
      }
    }
  }
  if (offers.size !== 1) throw new Error('No unambiguous EE offer');
  return [...offers.values()];
}

export function readOffers(source, html) {
  return source === EE ? readEE(html) : readFeed(source, html);
}
