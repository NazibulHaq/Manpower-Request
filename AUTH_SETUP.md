# Google Sign-In Access Control

This dashboard now uses Google Sign-In plus a server-side allowlist.

## Access rule

Only these exact Google accounts are authorized initially:

- tashfeen@nextventures.io
- nazibul.haq@nextventures.io
- surith@nextventures.io
- ong.choon@nextventures.io
- christopher.lam@nextventures.io
- ruweendra.annette@nextventures.io
- aleza.sharmin@nextventures.io
- chai.chuan@nextventures.io
- lysha.lee@nextventures.io
- bhaskar@nextventures.io
- janhvi.soni@nextventures.io
- aj@nextventures.io
- galib@nextventures.io
- nazbir@nextventures.io
- elvira@nextventures.io

The allowlist is checked server-side after Google verifies the ID token. The email list is not embedded in the frontend.

## Vercel environment variables

Set these in the Vercel project settings for the Production environment (and Preview if you want to test there):

1. `GOOGLE_OAUTH_CLIENT_ID`
   - The OAuth 2.0 Web Client ID created in Google Cloud Console.
2. `DASHBOARD_SESSION_SECRET`
   - A long random secret used to sign the HttpOnly session cookie.
3. `ALLOWED_DASHBOARD_EMAILS`
   - The comma-separated allowlist from `.env.example`.
4. `GOOGLE_SERVICE_ACCOUNT_JSON`
   - Keep the existing Google Sheets service-account JSON already used by `api/sheets.js`.

## Google Cloud OAuth setup

Create a Google OAuth 2.0 Web application client in the Google Cloud project used for this dashboard.

Configure the dashboard's Vercel domain as an authorized JavaScript origin. The Google Identity Services button uses popup mode, so this implementation does not require a traditional OAuth redirect URI.

The Google OAuth client ID is public. Do not expose a client secret in the frontend.

## Security behavior

- A user must first authenticate with Google.
- The server verifies the Google ID token.
- The token audience must match `GOOGLE_OAUTH_CLIENT_ID`.
- The Google account must be verified.
- The Google Workspace hosted-domain claim must be `nextventures.io`.
- The exact email must be present in `ALLOWED_DASHBOARD_EMAILS`.
- Only then is an HttpOnly, Secure, SameSite session cookie created.
- `/api/sheets` requires that session cookie before returning any Google Sheets data.
- No employee, headcount, hiring, or spillover fallback dataset is embedded in `index.html`.
- Sign out clears the session cookie.

## Scaling later

When access expands, update the server-side authorization source rather than putting email checks into frontend JavaScript. The current implementation can move from an exact allowlist to a managed Google Workspace group or another centrally managed authorization source without changing the dashboard's data layer.
