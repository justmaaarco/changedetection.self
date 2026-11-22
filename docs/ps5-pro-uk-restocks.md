# PS5 Pro UK restock alerts

The preset tracks the new, standalone PS5 Pro 2 TB. It checks once a minute and alerts when a listing first reports stock at **£789.99 or less** before delivery. Each alert includes the price and the retailer's product link. A sold-out listing can alert again on its next restock.

The preset uses StockCheckers for PlayStation Direct and other UK retailers, Stock Checker for Argos, John Lewis and Smyths, and the EE product page for EE. Argos checks local availability by postcode. These are stock observations and inventory can sell out before checkout.

## Start the dashboard

From this repository, use Python 3.11 or newer in a virtual environment. Install its dependencies with `python -m pip install -r requirements.txt`. Run the seed command with the dashboard stopped. It adds missing watches and preserves existing watches and settings.

```text
python -m changedetectionio.processors.ps5_restock.seed ./datastore
python changedetection.py -d ./datastore -h 127.0.0.1 -p 5000
```

Open [the local dashboard](http://127.0.0.1:5000). For alerts when this PC is asleep or off, run this fork on an always-on host and keep its datastore persistent.

## Configure private alert destinations

Open **Groups**, edit **PS5 Pro UK restocks**, then open **Notifications**. Add one Apprise notification URL per line. Save the group and use the dashboard's test notification control to check delivery. The destinations live in the private datastore. Keep the datastore and notification URLs out of Git.

- **Email.** Use the email setup form to enter your SMTP provider's server, sender credentials and the email address that should receive the alerts. Use the provider's TLS settings and an app password or SMTP key when required. The self-hosted app needs a sender to deliver email. [ChangeDetection email setup](https://changedetection.io/tutorial/email-notification-when-web-page-changes-how)
- **SMS.** Use an SMS-capable Twilio sender and the receiving number in international format. Enter an Apprise URL such as `twilio://ACCOUNT_SID:AUTH_TOKEN@FROM_NUMBER/TO_NUMBER?overflow=upstream`. Replace the placeholders in the private dashboard. SMS may incur carrier or provider fees. [Apprise Twilio documentation](https://github.com/caronc/apprise/wiki/Notify_twilio)
