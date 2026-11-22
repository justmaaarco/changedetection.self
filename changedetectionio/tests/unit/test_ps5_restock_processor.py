from queue import Queue
from unittest.mock import patch

import apprise

from changedetectionio import __version__
from changedetectionio.notification.handler import process_notification
from changedetectionio.notification_service import NotificationService
from changedetectionio.processors.ps5_restock.offers import Offer, PRODUCT, SOURCE
from changedetectionio.processors.ps5_restock.processor import perform_site_check, process_offers
from changedetectionio.processors.ps5_restock.seed import seed
from changedetectionio.store import ChangeDetectionStore


def test_stock_and_price_must_qualify_together():
    offer = Offer('PlayStation Direct', 79000, 'In stock', PRODUCT)
    state, restocks = process_offers([offer], {})
    assert not restocks

    offer = offer._replace(price_pence=78999)
    state, restocks = process_offers([offer], state)
    assert restocks == [offer]
    state, restocks = process_offers([offer._replace(status='Unknown')], state)
    assert not restocks
    state, restocks = process_offers([offer], state)
    assert not restocks
    state, _ = process_offers([offer._replace(status='Out of stock')], state)
    assert process_offers([offer], state)[1] == [offer]


def test_preset_routes_restock_to_group_email_and_sms(tmp_path):
    datastore = ChangeDetectionStore(str(tmp_path), version_tag=__version__, include_default_watches=False)
    assert seed(datastore) == 3
    assert seed(datastore) == 0
    watch = next(w for w in datastore.data['watching'].values() if w['url'] == SOURCE)
    watch_id = watch['uuid']
    processor = perform_site_check(datastore, watch_id)
    product_url = 'https://direct.playstation.com/en-gb/buy-consoles/playstation5-pro-console-2-tb'
    processor.fetcher.content = f'''
        <table><tr><td data-label="Store">PlayStation Direct</td>
        <td data-label="Product"><a href="{product_url}">Sony Playstation PS5 Pro</a></td>
        <td data-label="Price">&pound;789.99</td><td data-label="">In Stock</td></tr></table>
    '''
    changed, update, snapshot = processor.run_changedetection(watch)
    assert changed
    assert snapshot == f'PS5 Pro in stock at PlayStation Direct for £789.99\n{PRODUCT}'
    datastore.update_watch(watch_id, update)
    watch.save_history_blob(snapshot, int(watch.newest_history_key) + 1, update['previous_md5'])
    assert not processor.run_changedetection(watch)[0]

    group = datastore.data['settings']['application']['tags'][watch['tags'][0]]
    group['notification_urls'] = [
        'mailtos://fixture:fixture@example.com?to=alerts%40example.com',
        'twilio://AC' + '0' * 32 + ':' + 'a' * 32 + '@+12025550110/+12025550111?overflow=upstream',
    ]
    queued = Queue()
    NotificationService(datastore, queued).send_content_changed_notification(watch_id)
    with patch.object(apprise.Apprise, 'notify', autospec=True, return_value=True) as notify:
        process_notification(queued.get_nowait(), datastore)

    assert [call.args[0][0].service_name for call in notify.call_args_list] == ['E-Mail', 'Twilio']
    assert all(call.kwargs['body'] == snapshot for call in notify.call_args_list)
