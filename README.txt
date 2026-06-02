House Tracker Utilities

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
