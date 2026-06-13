House Tracker Utilities
Adding notification secrets in cloudflare and github 
This app can run in two ways:
1. Local/offline mode: open public/index.html in your browser. Data saves in that browser's localStorage.
2. Cloud mode: deploy to Cloudflare Pages. Data is shared across devices through Cloudflare KV.

Important security note
This tracker contains private property, account, and bill details. Do not publish it as an unprotected public website.
For Cloudflare Pages, protect the whole site with Cloudflare Access or another authentication layer before sharing the URL.

Cloudflare Pages deployment
This repository is a Cloudflare Pages app with Pages Functions. It is not a standalone Cloudflare Worker project. If a separate Worker deployment fails but the Pages deployment succeeds, use the Pages deployment; `/api/items` is served from `functions/api/items.js` by Pages Functions.

1. Create a Cloudflare account and install Wrangler if you want to deploy from the command line:
   npm install -g wrangler
2. Log in:
   wrangler login
3. Create a KV namespace for the shared tracker data:
   wrangler kv namespace create TRACKER_BACKUPS
4. In the Cloudflare dashboard, create a Pages project from this repository.
5. Use these Pages settings:
   - Framework preset: None
   - Build command: leave blank
   - Build output directory: public
   - Functions directory: functions
6. Add a KV namespace binding in the Pages project settings:
   - Variable name / binding: TRACKER_BACKUPS
   - KV namespace: the namespace created in step 3
7. Add Cloudflare Access protection for the Pages application so only approved users can open the app.
8. Deploy. The first visit seeds KV from public/data.json. Later changes are saved to KV and loaded from any browser/device.

Optional command-line deployment
If the KV binding has already been configured for the Pages project in Cloudflare, deploy with one of these Pages commands:
- npm run deploy
- wrangler pages deploy public --project-name utilities-tracker

Do not use `wrangler deploy` for this repository. That command deploys a standalone Worker and can fail because the API is intentionally written as a Pages Function under `functions/`.

How cloud saving works
- The browser loads /api/items.
- functions/api/items.js reads the shared state from the TRACKER_BACKUPS KV namespace.
- If KV is empty, it seeds the namespace once from public/data.json.
- Every save posts the full tracker state back to /api/items.
- If the API is unavailable, the browser falls back to the local browser backup.
- The page now shows a cloud-storage status banner. If it says cloud storage is not configured or unreachable, edits are only in the current browser and will not appear on another phone/computer until the Pages Function and TRACKER_BACKUPS KV binding are fixed.
- Safari Private Browsing or restrictive site settings can block localStorage. The app treats localStorage as a backup only, so Safari local backup failures should not stop saves from posting to Cloudflare KV when cloud storage is connected.


Fixing "Cloud storage is not configured"
That banner means the Pages Function is running, but Cloudflare did not provide the required TRACKER_BACKUPS KV binding to /api/items. To fix it:
1. In Cloudflare, open Workers & Pages, select the utilities-tracker Pages project, then open Settings.
2. Under Functions, add a KV namespace binding named exactly TRACKER_BACKUPS. The name is case-sensitive.
3. Select the KV namespace you created with `wrangler kv namespace create TRACKER_BACKUPS`, or create a new namespace if one does not exist yet.
4. Add the same binding to Production and any Preview environment where you test the app.
5. Redeploy the Pages project, then refresh the app. The banner should change to "Shared cloud storage is connected."

If the banner remains after redeploying, check that the deployed project uses this repository's `functions/` directory and that `/api/items` returns JSON rather than a 404.


Local use
1. Open public/index.html in your browser, or serve the folder with a small static server.
2. Your data saves locally in that browser.

Utilities now opens as the default tab.


## Utility Autopay
Each utility bill now has an Autopay On/Off option.
If Autopay is On and the bill due date is today or earlier, the tracker automatically marks the bill as Paid and sets the paid date to today.


## Autopay paid date behavior
When Autopay automatically marks a utility bill as Paid, the Paid Date is set equal to the bill Due Date.


## Utilities Other section
Under each house in Utilities, there is now a separate “Other” section.
Other bill types:
- Auto Insurance
- Car Payment
- Mobile Phones
- Soccer Club
- Math Class

These use the same utility bill fields, including Autopay.


## Separate Other block
The Utilities page now has a standalone 'Other' block similar to the property sections.


## Other bill add flow
When adding a bill, the House dropdown now includes “Other.”
If “Other” is selected, the Bill Type dropdown only shows:
- Auto Insurance
- Car Payment
- Mobile Phones
- Soccer Club
- Math Class

The separate Other block also has its own “+ Add bill to Other” button.


## Paid date visibility
When a bill status is Not paid:
- Paid Date is hidden
- Paid Date is not required
- Any existing Paid Date is cleared automatically


## New house behavior
Adding a new house now creates only the house record.
No bills or maintenance items are created automatically; use “+ Add bill” or “+ Add item” when needed.


## Utility bill sorting
All utility and Other bills are now automatically ordered by Due Date, with the soonest due bills shown first.


## Mortgage label update
Changed the mortgage label:
- From: "Due day each month (20th for previous month filing)"
- To: "Due on the 1-st"


## Mortgage / Taxes layout
The Mortgage / Taxes tab is now separated into:
- Monthly Payments
  - Mortgage
  - Florida Sales Tax
  - Tourist Tax
- Annual Payments
  - Insurance
  - Property Taxes


## Mortgage / Taxes / Insurance layout
The tab now shows:
1. Monthly Dues — All Houses
2. Annual Dues — All Houses

Each table combines records across all houses instead of grouping by individual house cards.


## Label update only
Changed visible label:
- Insurance -> Hazardous Insurance

No other functionality changes were made.


## Custom Mortgage/Taxes/Insurance items
Added a “+ Add item” button under the Mortgage/Taxes/Insurance tab.
You can:
- Choose the house from a dropdown
- Choose Monthly or Annual
- Enter your own item name
- Use the same fields: company/agency, login, account/policy number, amount, due date, paid status, paid date, notes

## Email due-date notifications
The app now includes a Cloudflare Pages Function at `/api/notifications` that sends email reminders to:
- Anna: annagoranova17@gmail.com
- Lubo: liubomirm@gmail.com

The notification looks for utility bills, Mortgage / Taxes / Insurance finance rows, custom finance items, and active credit cards that are due exactly 2 days after the day the endpoint runs. Paid, inactive, hidden/deleted finance rows, and closed credit cards are skipped. Monthly finance rows are considered due again when their paid date is from an earlier month than the upcoming due date. A KV marker prevents duplicate sends for the same recipient, item, and due date.

Email delivery uses Resend. Configure these environment variables in the Cloudflare Pages project before turning on the notification schedule:
- `RESEND_API_KEY`: Resend API key.
- `NOTIFICATION_FROM_EMAIL`: verified sender email address, for example `Utilities Tracker <reminders@yourdomain.com>`.
- `NOTIFICATION_SECRET`: a private token required by the notification endpoint. The name is case-sensitive and must be spelled exactly `NOTIFICATION_SECRET`.

To test without sending email, make a POST request with `dryRun=true`:
```bash
curl -X POST "https://YOUR-PAGES-DOMAIN/api/notifications?dryRun=true" \
  -H "Authorization: Bearer YOUR_NOTIFICATION_SECRET" \
  -H "Content-Type: application/json" \
  --data '{}'
```

Reminders are sent by the GitHub Actions workflow in `.github/workflows/send-notifications.yml`. The workflow runs every day at 17:20 UTC (12:20 PM EST / 1:20 PM EDT) and makes a POST request to `/api/notifications` with the same bearer token. Add these repository secrets before relying on the schedule:
- `NOTIFICATION_BASE_URL`: the deployed Pages site URL, for example `https://YOUR-PAGES-DOMAIN`.
- `NOTIFICATION_SECRET`: the same private token configured in Cloudflare Pages. This repository secret and the Cloudflare Pages environment variable must have identical values.

If the Pages site is protected by Cloudflare Access, also create a Cloudflare Access service token and add both optional repository secrets so GitHub Actions can reach the protected endpoint:
- `CF_ACCESS_CLIENT_ID`: Cloudflare Access service token client ID.
- `CF_ACCESS_CLIENT_SECRET`: Cloudflare Access service token client secret.

The workflow prints the endpoint HTTP status and JSON response. If it fails, check whether the response says `NOTIFICATION_SECRET is not configured in Cloudflare Pages` (missing Pages environment variable), `Missing notification secret header` (the workflow did not send the secret), `Notification secret does not match Cloudflare Pages configuration` (the GitHub repository secret and Pages environment variable differ), mentions missing `RESEND_API_KEY` or `NOTIFICATION_FROM_EMAIL` (missing Pages environment variables), or returns a Cloudflare Access page/403 (missing Access service-token secrets).

Quick checklist for the previous `NOTIFICATION_SECRET` failure:
1. In Cloudflare Pages > Settings > Environment variables, add `NOTIFICATION_SECRET` for Production, save it, and redeploy the Pages project.
2. In GitHub > Settings > Secrets and variables > Actions, add repository secret `NOTIFICATION_SECRET` with the exact same value.
3. Do not name either secret `NOTIFICATIO_SECRET`, `NOTIFICATION_SECRETS`, or any lowercase variation.
4. Manually rerun the `Send due-date notifications` workflow and confirm the log prints a 200 HTTP status.

If the Pages site is protected by Cloudflare Access, also create a Cloudflare Access service token and add both optional repository secrets so GitHub Actions can reach the protected endpoint:
- `CF_ACCESS_CLIENT_ID`: Cloudflare Access service token client ID.
- `CF_ACCESS_CLIENT_SECRET`: Cloudflare Access service token client secret.

The workflow prints the endpoint HTTP status and JSON response. If it fails, check whether the response says `Unauthorized notification request` (the GitHub secret does not match the Pages `NOTIFICATION_SECRET`), mentions missing `RESEND_API_KEY` or `NOTIFICATION_FROM_EMAIL` (missing Pages environment variables), or returns a Cloudflare Access page/403 (missing Access service-token secrets).

The endpoint computes the target due date as today plus 2 days. You can also run the workflow manually from GitHub Actions using `workflow_dispatch`.
