"""Add the PS5 Pro preset to an offline datastore, then start ChangeDetection normally."""

import argparse
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path

from changedetectionio import __version__
from changedetectionio.store import ChangeDetectionStore

from . import processor_name
from .offers import DIRECT_PRODUCTS, SOURCE, SUPPLEMENT


TAG = 'PS5 Pro UK restocks'
WATCHES = {
    SOURCE: ('PS5 Pro · UK retailers', ''),
    SUPPLEMENT: ('PS5 Pro · Argos, John Lewis and Smyths', ''),
    **{url: (f'PS5 Pro · {retailer}', url) for url, (retailer, _, _) in DIRECT_PRODUCTS.items()},
}


def seed(datastore):
    existing = {
        watch['url'] for watch in datastore.data['watching'].values()
        if watch.get('processor') == processor_name
    }
    new_count = 0
    for url, (title, link) in WATCHES.items():
        if url in existing:
            continue
        watch_id = datastore.add_watch(url, tag=TAG, extras={
            'title': title,
            'link_to_open': link,
            'processor': processor_name,
            'fetch_backend': 'html_requests',
            'time_between_check': {'minutes': 1},
            'time_between_check_use_default': False,
            'notification_title': 'PS5 Pro restock at £789.99 or less',
            'notification_body': '{{ current_snapshot }}',
            'notification_format': 'text',
            'llm_backend_profile': False,
        })
        if not watch_id:
            raise RuntimeError(f'Could not create watch for {url}')
        # The native worker skips notifications on its first snapshot. This initial
        # snapshot lets the preset notify if the very first live check finds stock.
        initial = 'Waiting for the first PS5 Pro stock check.'
        datastore.data['watching'][watch_id].save_history_blob(
            contents=initial,
            timestamp=int(datetime.now(timezone.utc).timestamp()) - 1,
            snapshot_id=sha256(initial.encode('utf-8')).hexdigest(),
        )
        new_count += 1
    return new_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('datastore', type=Path)
    options = parser.parse_args()
    options.datastore.mkdir(parents=True, exist_ok=True)
    datastore = ChangeDetectionStore(
        datastore_path=str(options.datastore.resolve()), version_tag=__version__, include_default_watches=False,
    )
    print(f'Added {seed(datastore)} PS5 Pro watches.')


if __name__ == '__main__':
    main()
