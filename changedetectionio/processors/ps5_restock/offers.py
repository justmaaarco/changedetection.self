"""Parse the fixed UK PS5 Pro listings from public product pages and stock feeds."""

from html import unescape
import json
import math
import re
from typing import NamedTuple, Optional
from urllib.parse import parse_qs, unquote, urlsplit, urlunsplit


SOURCE = "https://www.stockcheckers.co.uk/sony/playstation/ps5/ps5-pro-console.php"
SUPPLEMENT = "https://stock-checker.com/products/gaming/ps5-pro"
PRODUCT = "https://www.playstation.com/en-gb/ps5/ps5-pro/buy-now/?productCode=1000050928-GB"
UK_RRP_PENCE = 78_999
DIRECT_PRODUCTS = {
    "https://ee.co.uk/products/ps5-pro-console-b-chassis": ("EE Store", "mpn", "1000050725"),
}
RETAILERS = {
    "ao.com": "AO",
    "amazon.co.uk": "Amazon",
    "currys.co.uk": "Currys",
    "ee.co.uk": "EE Store",
    "game.co.uk": "GAME",
    "direct.playstation.com": "PlayStation Direct",
    "playstation.com": "PlayStation Direct",
    "shopto.net": "ShopTo",
    "thegamecollection.net": "The Game Collection",
    "very.co.uk": "Very",
}
# Use the product IDs to recognise listings even if their readable slugs change.
EXTRA_RETAILERS = {
    "argos.co.uk": ("Argos", "/product/7797426", "https://www.argos.co.uk/product/7797426"),
    "smythstoys.com": (
        "Smyths", "/p/244166",
        "https://www.smythstoys.com/uk/en-gb/gaming-and-tech/playstation-5/playstation-5-consoles/"
        "playstation-5-pro-console-2tb-digital-edition-slim/p/244166",
    ),
    "johnlewis.com": (
        "John Lewis", "/p114409149",
        "https://www.johnlewis.com/playstation-5-pro-console-with-dualsense-controller/p114409149",
    ),
}
AFFILIATE_QUERY = {
    "awin1.com": "ued", "go.skimresources.com": "url", "jdoqocy.com": "url", "redirect.viglink.com": "out",
}
ROWS = re.compile(r"<tr\b[^>]*>(.*?)</tr\s*>", re.IGNORECASE | re.DOTALL)
CELLS = re.compile(r'<td\b[^>]*\sdata-label\s*=\s*["\']([^"\']*)["\'][^>]*>(.*?)</td\s*>', re.I | re.S)
UNLABELLED_CELLS = re.compile(r"<td\b[^>]*>(.*?)</td\s*>", re.I | re.S)
LINK = re.compile(r'<a\b[^>]*\shref\s*=\s*["\']([^"\']+)["\'][^>]*>(.*?)</a\s*>', re.I | re.S)
JSON_LD = re.compile(r'<script\b[^>]*\stype\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script\s*>', re.I | re.S)
CONSOLE_TITLE = re.compile(r"\b(?:ps\s*5|playstation\s*5?)\s+pro\b", re.I)
EXCLUDED_OFFER = re.compile(
    r"\b(?:bundle|anniversary|limited edition|renewed|refurbished|recertified|used|pre[- ]owned|"
    r"open box|third[- ]party|marketplace|gift card|digital voucher|skin|case|cover|lease)\b",
    re.I,
)


class Offer(NamedTuple):
    retailer: str
    price_pence: Optional[int]
    status: str
    url: str
    source: str = "Stock feed"


def cell_text(markup):
    return " ".join(unescape(re.sub(r"<[^>]+>", " ", markup)).split())


def pounds(pence):
    if pence is None:
        return "—"
    whole, fraction = divmod(pence, 100)
    return f"£{whole:,}.{fraction:02d}"


def parse_pence(markup):
    price = re.fullmatch(r"£\s*(\d{1,5})(?:\.(\d{1,2}))?", cell_text(markup).replace(",", ""))
    if not price:
        return None
    return (int(price[1]) * 100 + int((price[2] or "").ljust(2, "0"))) or None


def stock_status(markup):
    return {
        "in stock": "In stock", "out of stock": "Out of stock", "pre-order": "Pre-order",
    }.get(cell_text(markup).casefold(), "Unknown")


def offer_order(offer):
    price = offer.price_pence if offer.price_pence is not None else math.inf
    return offer.status != "In stock", price, offer.retailer


def retailer_link(href):
    target = urlsplit(unescape(href))
    host = target.netloc.lower().removeprefix("www.")
    if target.scheme != "https":
        return None
    if host in AFFILIATE_QUERY:
        params = parse_qs(target.query)
        destination = params.get(AFFILIATE_QUERY[host], [""])[0]
        if host == "redirect.viglink.com" and not destination:
            destination = params.get("u", [""])[0]
        target = urlsplit(destination)
    elif host in ("sonyps.prf.hn", "game.prf.hn"):
        _, marker, destination = target.path.partition("/destination:")
        if not marker:
            return None
        target = urlsplit(unquote(destination))

    host = target.netloc.lower().removeprefix("www.")
    if target.scheme != "https" or target.path in ("", "/"):
        return None
    if host in EXTRA_RETAILERS:
        retailer, path_suffix, url = EXTRA_RETAILERS[host]
        if target.path.rstrip("/").endswith(path_suffix):
            return retailer, url
        return None
    if host not in RETAILERS:
        return None
    if host == "direct.playstation.com":
        if target.path.rstrip("/") != "/en-gb/buy-consoles/playstation5-pro-console-2-tb":
            return None
        return RETAILERS[host], PRODUCT
    if host == "playstation.com":
        if target.path != urlsplit(PRODUCT).path:
            return None
        code = parse_qs(target.query).get("productCode")
        if code not in (None, ["1000050928-GB"]):
            return None
        return RETAILERS[host], PRODUCT
    fragment = target.fragment if host == "game.co.uk" and re.fullmatch(r"colcode=\d+", target.fragment) else ""
    if host == "amazon.co.uk":
        asin = re.search(r"/dp/([A-Z0-9]{10})(?:/|$)", target.path)
        if not asin:
            return None
        return RETAILERS[host], f"https://www.amazon.co.uk/dp/{asin[1]}"
    return RETAILERS[host], urlunsplit(("https", target.netloc, target.path, "", fragment))


def read_stock(html):
    offers = {}
    stock_rows = 0
    for row in ROWS.findall(html):
        cells = {name.casefold(): body for name, body in CELLS.findall(row)}
        if not {"store", "product", "price"} <= cells.keys():
            continue
        stock_rows += 1
        link = LINK.search(cells["product"])
        status = cell_text(cells.get("stock", cells.get("", ""))).casefold()
        if not link or not CONSOLE_TITLE.search(cell_text(link[2]).replace("®", "").replace("™", "")):
            continue
        if EXCLUDED_OFFER.search(cell_text(cells["product"])) or EXCLUDED_OFFER.search(status):
            continue
        price_pence = parse_pence(cells["price"])
        if not price_pence:
            continue
        try:
            destination = retailer_link(link[1])
        except ValueError:
            continue
        if destination is None:
            continue
        retailer, url = destination
        display_status = stock_status(status)
        offer = Offer(retailer, price_pence, display_status, url)
        previous = offers.get(url)
        if previous is None or (status == "in stock", -price_pence) > (
            previous.status == "In stock", -previous.price_pence
        ):
            offers[url] = offer
    if not stock_rows:
        raise ValueError("Could not read the PS5 Pro retail table.")
    return sorted(offers.values(), key=offer_order)


def extra_offer_placeholders():
    return {url: Offer(retailer, None, "Unknown", url) for retailer, _, url in EXTRA_RETAILERS.values()}


def read_supplement(html):
    offers = extra_offer_placeholders()
    for row in ROWS.findall(html):
        cells = UNLABELLED_CELLS.findall(row)
        if len(cells) != 5 or not CONSOLE_TITLE.search(cell_text(cells[1]).replace("®", "").replace("™", "")):
            continue
        title = cell_text(cells[1])
        link = LINK.search(cells[-1])
        if not link or EXCLUDED_OFFER.search(title) or EXCLUDED_OFFER.search(cell_text(link[2])):
            continue
        try:
            destination = retailer_link(link[1])
        except ValueError:
            continue
        if destination is None or destination[1] not in offers:
            continue
        retailer, url = destination
        price = parse_pence(cells[2])
        status = stock_status(link[2]) if price is not None else "Unknown"
        offers[url] = Offer(retailer, price, status, url)
    if all(offer.price_pence is None for offer in offers.values()):
        raise ValueError("Could not read the Argos, Smyths and John Lewis listings.")
    return tuple(offers.values())


def read_retailer_page(html, url):
    retailer, id_key, model_id = DIRECT_PRODUCTS[url]
    states = {"InStock": "In stock", "OutOfStock": "Out of stock", "SoldOut": "Out of stock",
              "PreOrder": "Pre-order", "PreSale": "Pre-order"}
    matching = set()
    for script in JSON_LD.findall(html):
        try:
            product = json.loads(script)
        except ValueError:
            continue
        if not isinstance(product, dict) or product.get("@type") != "Product" or product.get(id_key) != model_id:
            continue
        offers = product.get("offers", ())
        if isinstance(offers, dict):
            offers = [offers]
        if not isinstance(offers, (list, tuple)):
            continue
        for offer in offers:
            if not isinstance(offer, dict) or offer.get("url") != url or offer.get("priceCurrency") != "GBP":
                continue
            condition = offer.get("itemCondition", "https://schema.org/NewCondition")
            if condition != "https://schema.org/NewCondition":
                continue
            status = states.get(str(offer.get("availability", "")).removeprefix("https://schema.org/"))
            price = parse_pence(f"£{offer.get('price', '')}")
            if status and price is not None:
                matching.add(Offer(retailer, price, status, url, "Retailer site"))
    if len(matching) != 1:
        raise ValueError("The product page did not report one definite price and stock status.")
    return tuple(matching)


def read_restock_source(url, html):
    if url in DIRECT_PRODUCTS:
        return read_retailer_page(html, url)
    if url == SUPPLEMENT:
        return read_supplement(html)
    if url != SOURCE:
        raise ValueError('Use one of the supported UK PS5 Pro watch URLs.')

    # Keep one watch responsible for each product so independent feeds cannot
    # send consecutive notifications about the same retailer.
    direct_retailers = {retailer for retailer, _, _ in DIRECT_PRODUCTS.values()}
    extra_retailers = {retailer for retailer, _, _ in EXTRA_RETAILERS.values()}
    offers = tuple(
        offer for offer in read_stock(html)
        if offer.retailer not in direct_retailers and offer.retailer not in extra_retailers
    )
    if not offers:
        raise ValueError('The stock feed did not return any tracked UK PS5 Pro listings.')
    return offers
