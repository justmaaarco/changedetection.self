# PS5 Pro UK restock alerts

The preset tracks the new, standalone PS5 Pro 2 TB. It checks once a minute and alerts when a listing first reports stock at **£789.99 or less** before delivery. Each alert includes the price and the retailer's product link. A sold-out listing can alert again on its next restock.

The preset watches 22 known UK retailers across two public feeds and the EE product page. It covers AO, Amazon, Argos, Back to the Office, Box, Costco, Currys, EE, Fonehouse, GAME, HMV, Jacamo, John Lewis, Joybuy, O2, Overclockers UK, PlayStation Direct, Scan, ShopTo, Smyths, The Game Collection and Very. Argos checks local availability by postcode. These are stock observations and inventory can sell out before checkout.

## Start the dashboard

From this repository, use Python 3.11 or newer in a virtual environment. Install its dependencies with `python -m pip install -r requirements.txt`. Run the seed command with the dashboard stopped. It adds missing watches and preserves existing watches and settings.

```text
python -m changedetectionio.processors.ps5_restock.seed ./datastore
python changedetection.py -d ./datastore -h 127.0.0.1 -p 5000
```

Open [the local dashboard](http://127.0.0.1:5000). For alerts when this PC is asleep or off, run this fork on an always-on host and keep its datastore persistent.

## Configure private alert destinations

Open **Groups**, edit **PS5 Pro UK restocks**, then open **Notifications**. Add one Apprise notification URL per line. Save the group and use the dashboard's test notification control to check delivery. The destinations live in the private datastore. Keep the datastore and notification URLs out of Git.

For encrypted alert configuration, use the Cloudflare Worker below. The local dashboard stores Apprise notification URLs in its datastore, where the application can read them.

- **Email.** Use the email setup form to enter your SMTP provider's server, sender credentials and the email address that should receive the alerts. Use the provider's TLS settings and an app password or SMTP key when required. The self-hosted app needs a sender to deliver email. [ChangeDetection email setup](https://changedetection.io/tutorial/email-notification-when-web-page-changes-how)
- **SMS.** Use an SMS-capable Twilio sender and the receiving number in international format. Enter an Apprise URL such as `twilio://ACCOUNT_SID:AUTH_TOKEN@FROM_NUMBER/TO_NUMBER?overflow=upstream`. Replace the placeholders in the private dashboard. SMS may incur carrier or provider fees. [Apprise Twilio documentation](https://github.com/caronc/apprise/wiki/Notify_twilio)

## Run stock checks on Cloudflare

The Worker runs the stock checks every minute with persistent alert state. It uses the supplemental feed for EE if the product page is unavailable. Alerts are sent as soon as a check finds a qualifying offer and a notification channel is connected. Retailer and feed updates determine when stock becomes visible. There is no public HTTP route.

From the repository root, deploy to your Cloudflare account with Wrangler.

```sh
npx wrangler deploy --config deploy/cloudflare/wrangler.toml
npx wrangler tail --config deploy/cloudflare/wrangler.toml
```

In **Workers & Pages**, open **ps5-pro-uk-restocks** and view **Observability** for each source's listing count, detected qualifying stock and delivery status. The full ChangeDetection dashboard can run on an always-on Docker host with a persistent `/datastore`. Use Cloudflare Tunnel and Access if you need private remote access to that dashboard. [Cloudflare Tunnel and Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)

### Configure encrypted alert delivery

In the Cloudflare Worker, open **Settings → Variables and Secrets**. Choose **Secret** for each value in the table. Cloudflare encrypts these values at rest and hides them after you save. To set a value from a terminal, use the hidden prompt from `npx wrangler secret put NAME --config deploy/cloudflare/wrangler.toml`. Use the prompt for the secret value and keep it out of command arguments and project files. Each channel is optional. [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

| Channel | Configuration |
| --- | --- |
| Email | Onboard a sender domain in Cloudflare Email Service and verify the recipient if required. Set `ALERT_EMAIL_FROM` and `ALERT_EMAIL_TO`. The Worker uses the `EMAIL` binding in `wrangler.toml` and requires no mailbox password. |
| Telegram | Create a bot with BotFather and start a private chat with it. Set `TELEGRAM_BOT_TOKEN` and the destination `TELEGRAM_CHAT_ID`. |
| SMS | Create a dedicated Twilio API key with message creation permission. Set `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_FROM` and `ALERT_SMS_TO`. Use an SMS-capable sender and an international-format recipient. Twilio charges may apply. [Twilio API keys](https://www.twilio.com/docs/iam/api-keys/keys-in-console) |

Once a channel is configured, add a **Text** variable named `ALERT_TEST` with a value such as `email:1`, `sms:1`, or `telegram:1`. The next check attempts one clearly labelled test for that channel, including the PS5 Pro product link. Check **Observability** for the provider result and confirm it arrived. Use a fresh identifier, such as `email:2`, to send another test. Standard SMS charges apply to tests.

If both the Worker and ChangeDetection are running, configure alert destinations in one place to avoid duplicate messages.

## Be ready at checkout

Set the optional **Text** variable `SIGN_IN_SHORTCUTS` to a comma-separated selection of `playstation`, `argos`, `smyths`, and `john-lewis`. For example, `playstation,argos` adds the retailer's official account link to matching email and Telegram alerts. SMS messages include the product link. Leave the setting blank for product links only.

Sign in in your usual browser. PlayStation supports a passkey, and John Lewis also offers sign-in by a link it sends to your email. Where a retailer uses a password, keep it in your device's password manager. The Worker receives no retailer passwords, passkeys, session cookies or payment details.

If an alert opens in Telegram's or your mail app's built-in browser, use **Open in browser** to reuse your signed-in session. Sign-in and checkout happen on the retailer's website. [PlayStation passkey setup](https://www.playstation.com/en-gb/support/account/set-up-passkey/) · [John Lewis sign-in options](https://www.johnlewis.com/customer-services/orders/your-john-lewis-account)
