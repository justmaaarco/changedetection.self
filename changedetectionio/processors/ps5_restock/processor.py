"""Send a native ChangeDetection notification when a listing becomes eligible."""

from hashlib import sha256

from changedetectionio.processors.base import difference_detection_processor
from changedetectionio.processors.exceptions import ProcessorException

from .offers import (
    DIRECT_PRODUCTS, SOURCE, SUPPLEMENT, UK_RRP_PENCE, offer_order, pounds,
    read_restock_source,
)

STATE = 'processor_state_ps5_restock'
SOURCE_URLS = {SOURCE, SUPPLEMENT, *DIRECT_PRODUCTS}


def process_offers(offers, previous):
    eligible_by_url = dict(previous)
    restocks = []
    for offer in sorted(offers, key=offer_order):
        if offer.status == 'Unknown' or offer.price_pence is None:
            continue
        qualifies = offer.status == 'In stock' and offer.price_pence <= UK_RRP_PENCE
        if qualifies and not eligible_by_url.get(offer.url):
            restocks.append(offer)
        eligible_by_url[offer.url] = qualifies
    return eligible_by_url, restocks


class perform_site_check(difference_detection_processor):
    async def validate_url_is_fetchable(self):
        if self.watch.link not in SOURCE_URLS:
            raise ValueError('Use one of the supported UK PS5 Pro watch URLs.')
        await super().validate_url_is_fetchable()

    def run_changedetection(self, watch, force_reprocess=False):
        try:
            offers = read_restock_source(watch.link, self.fetcher.content)
        except (TypeError, ValueError) as error:
            raise ProcessorException(message=str(error), url=watch.link) from error

        previous = (watch.get(STATE) or {}).get('eligible_by_url', {})
        eligible_by_url, restocks = process_offers(offers, previous)
        if restocks:
            snapshot = '\n\n'.join(
                f'PS5 Pro in stock at {offer.retailer} for {pounds(offer.price_pence)}\n{offer.url}'
                for offer in restocks
            )
        else:
            snapshot = '\n'.join(
                f'{offer.retailer} · {pounds(offer.price_pence)} · {offer.status}'
                for offer in sorted(offers, key=offer_order)
            )
        return bool(restocks), {
            STATE: {'eligible_by_url': eligible_by_url, 'offers': [offer._asdict() for offer in offers]},
            'previous_md5': sha256(snapshot.encode('utf-8')).hexdigest(),
        }, snapshot
