# Enquiry system setup

The website and Apps Script backend are prepared, but the form is **not live**
until you complete the Google setup, authorize it, deploy the web app, and
successfully test a submission. Do not put Google passwords, OAuth tokens, or
other account credentials in the website.

## 1. Create the response spreadsheet

1. Sign in to the Google account that should own the enquiry spreadsheet.
2. Create a new Google Sheet, for example **AJ Hostel Enquiries**.
3. Copy the spreadsheet ID from its URL. It is the text between `/d/` and
   `/edit` in `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`.
4. In the project file [`Code.gs`](./Code.gs), replace
   `PASTE_YOUR_GOOGLE_SHEET_ID_HERE` in `SPREADSHEET_ID` with that ID.

The script creates an `Enquiries` tab and its headers the first time it runs.
Do not manually rename or reorder those headers. The stored fields are the
submission timestamp, idempotency request ID, name, role, phone, email, room
preference, joining date, enquiry status, and email-notification status.

## 2. Create and authorize the Apps Script

1. Open the new spreadsheet and select **Extensions → Apps Script**.
2. Replace the editor's starter code with the full contents of this project's
   [`Code.gs`](./Code.gs), then save.
3. Select `setupSpreadsheet` in the function selector and click **Run**.
4. Review and grant the requested Google Sheets and email permissions. The
   script accesses only the spreadsheet ID configured in `Code.gs` and sends
   notifications to `ajboysgirlshostelpatna@gmail.com`.
5. Confirm that the `Enquiries` tab and its header row have been created.

`setupSpreadsheet` also requests the email quota so that Google prompts for
email authorization before deployment.

## 3. Deploy the web app

1. In Apps Script, select **Deploy → New deployment**.
2. Select the gear icon and choose **Web app**.
3. Set **Execute as** to **Me**.
4. Set **Who has access** to **Anyone** so website visitors can submit without
   signing in to Google.
5. Deploy and complete any authorization prompts.
6. Copy the web app URL ending in `/exec`. It should have this form:
   `https://script.google.com/macros/s/DEPLOYMENT_ID/exec`.
7. In [`index.html`](./index.html), replace
   `PASTE_YOUR_DEPLOYED_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE` in `CONFIG.endpoint`
   with that URL. Keep the URL quoted.
8. Save and publish the website. If you later change the Apps Script code,
   create a new version under **Deploy → Manage deployments → Edit**, deploy
   that version, and check whether the URL changed.

The endpoint is public because the form is public; it is not a credential.
Keep the spreadsheet ID and all Google account credentials out of frontend
configuration.

The notification recipient is configured in `Code.gs`. The website's separate
`CONFIG.email` setting controls the public email contact card and remains a
placeholder until you choose an address to publish there.

## 4. Test the complete submission flow

1. Open the deployed website over HTTPS and submit a test enquiry using valid
   details and a future joining date.
2. Confirm the page says the enquiry was saved only after the Apps Script
   response arrives.
3. Confirm one row appears in the spreadsheet and the owner notification
   arrives at `ajboysgirlshostelpatna@gmail.com`.
4. Submit again using the same browser request (or retry after a timeout) and
   confirm no duplicate row is added. A new intentional submission after
   success creates a new request.
5. Test an invalid phone/email and confirm it is rejected without a sheet row.
6. If email delivery fails, the form reports that the enquiry was saved but
   the notification email failed; the saved row remains in the sheet.

The form submission sends an ordinary HTML form POST to a hidden iframe and
receives the result through `postMessage`. This avoids a cross-origin `fetch`
preflight and does not require CORS response headers, which Apps Script cannot
configure. The Apps Script response enables iframe embedding for this flow;
the website verifies that the message came from HTTPS `script.google.com` or a
Google-owned `googleusercontent.com` host, and accepts it only when the channel,
request ID, and response status match the expected format. It intentionally
does not rely on `event.source` matching the named iframe, because Apps Script
may wrap or redirect its HTML response through a Google-hosted frame. Iframe
load is used only to improve the timeout message; a frame load alone is never
treated as a successful enquiry.

The browser waits up to five minutes for Apps Script to finish saving, sending
the notification email, and returning its response. If no valid response
arrives, the website reports that the result is uncertain and does not
resubmit. If you manually retry, the same request ID is reused so the backend
can prevent a duplicate row. Deploying the web app with **Anyone** access is
still required. This is basic spam protection, not a guarantee against
determined abuse.

The WhatsApp button opens a chat with the configured Business number. Form
submissions do not send automatic WhatsApp notifications; no WhatsApp Business
Platform/API has been configured.
