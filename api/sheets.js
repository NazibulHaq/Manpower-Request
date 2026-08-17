import { google } from 'googleapis';

/*
===========================================================
H2 MANPOWER DASHBOARD - GOOGLE SHEETS API CONNECTION
===========================================================

This replaces the old "Publish to Web / CSV" connection.

The dashboard still calls:

    /api/sheets?source=h2
    /api/sheets?source=hc
    /api/sheets?source=map
    /api/sheets?source=spill

This API now reads the PRIVATE Google Sheet directly.

IMPORTANT:
DO NOT put the service-account credentials in this file.

The credentials must be stored in Vercel Environment Variables.

===========================================================
*/


/*
-----------------------------------------------------------
1. GOOGLE SPREADSHEET
-----------------------------------------------------------
*/

const SPREADSHEET_ID =
  '1ee3ujtOuQH9_3WSAwn5Yr7aruPg2Bz99BhhPlBGD6-A';


/*
-----------------------------------------------------------
2. SHEET TAB GIDs
-----------------------------------------------------------

These are the GIDs from your current workbook.

H2 FY26 Plan:
1991353397

H1 FY26 Spillover:
208597519

Companywide HC:
1767679898

Department + Wing Mapping:
151350972

If you change the structure later, update the GIDs here.
-----------------------------------------------------------
*/

const SHEET_GIDS = {

  h2: 1991353397,

  hc: 1767679898,

  map: 151350972,

  spill: 208597519

};


/*
-----------------------------------------------------------
3. GOOGLE SHEETS READ-ONLY SCOPE
-----------------------------------------------------------
*/

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];


/*
-----------------------------------------------------------
4. CREATE GOOGLE AUTH CLIENT
-----------------------------------------------------------

The service account JSON is read from:

GOOGLE_SERVICE_ACCOUNT_JSON

in Vercel Environment Variables.

DO NOT paste the JSON credentials directly into GitHub.
-----------------------------------------------------------
*/

function getGoogleAuth() {

  const rawCredentials =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!rawCredentials) {

    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not configured in Vercel Environment Variables.'
    );

  }

  let credentials;

  try {

    credentials =
      JSON.parse(rawCredentials);

  } catch (error) {

    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the complete service-account JSON into the Vercel environment variable.'
    );

  }


  if (!credentials.client_email) {

    throw new Error(
      'Service-account JSON is missing client_email.'
    );

  }


  if (!credentials.private_key) {

    throw new Error(
      'Service-account JSON is missing private_key.'
    );

  }


  /*
  -------------------------------------------------------
  OPTIONAL DOMAIN-WIDE DELEGATION
  -------------------------------------------------------

  If your company does NOT allow you to share the Sheet
  directly with the service-account email, your Google
  Workspace administrator can configure Domain-Wide
  Delegation.

  If GOOGLE_IMPERSONATE_USER exists, the service account
  will impersonate that company Google account.

  Example:

  GOOGLE_IMPERSONATE_USER=nazibul.haq@nextventures.io

  Otherwise the service account accesses the Sheet directly.
  -------------------------------------------------------
  */

  const impersonateUser =
    process.env.GOOGLE_IMPERSONATE_USER || null;


  return new google.auth.JWT({

    email: credentials.client_email,

    key: credentials.private_key,

    scopes: SCOPES,

    subject: impersonateUser || undefined

  });

}


/*
-----------------------------------------------------------
5. CREATE SHEETS API CLIENT
-----------------------------------------------------------
*/

function getSheetsClient() {

  const auth = getGoogleAuth();

  return google.sheets({

    version: 'v4',

    auth

  });

}


/*
-----------------------------------------------------------
6. GET SHEET TITLE FROM GID
-----------------------------------------------------------

We use the GID rather than hardcoding the tab name.

This means the dashboard keeps working even if the tab
name contains spaces, &, +, etc.
-----------------------------------------------------------
*/

async function getSheetTitle(sheets, gid) {

  const response =
    await sheets.spreadsheets.get({

      spreadsheetId: SPREADSHEET_ID,

      fields: 'sheets(properties(sheetId,title))'

    });


  const allSheets =
    response.data.sheets || [];


  const matchingSheet =
    allSheets.find(

      sheet =>
        Number(sheet.properties.sheetId) === Number(gid)

    );


  if (!matchingSheet) {

    throw new Error(
      `No Google Sheet tab was found for GID ${gid}.`
    );

  }


  return matchingSheet.properties.title;

}


/*
-----------------------------------------------------------
7. READ A SHEET TAB
-----------------------------------------------------------

A:ZZ gives us a wide enough range for the current
dashboard data.

The returned Google Sheets values are converted into
CSV because your existing index.html already knows how
to parse CSV.

Therefore we don't need to rewrite the dashboard.
-----------------------------------------------------------
*/

async function readSheetAsCSV(sheets, gid) {

  const title =
    await getSheetTitle(sheets, gid);


  /*
  Escape single quotes in sheet names.

  Example:

  John's Data

  becomes:

  'John''s Data'
  */

  const safeTitle =
    `'${title.replace(/'/g, "''")}'`;


  const range =
    `${safeTitle}!A:ZZ`;


  const response =
    await sheets.spreadsheets.values.get({

      spreadsheetId: SPREADSHEET_ID,

      range,

      majorDimension: 'ROWS',

      valueRenderOption: 'FORMATTED_VALUE'

    });


  const values =
    response.data.values || [];


  if (!values.length) {

    throw new Error(
      `Google Sheet tab "${title}" returned no data.`
    );

  }


  return valuesToCSV(values);

}


/*
-----------------------------------------------------------
8. CONVERT GOOGLE SHEETS VALUES → CSV
-----------------------------------------------------------
*/

function valuesToCSV(values) {

  return values

    .map(row =>

      row

        .map(value => {

          const text =
            value === null || value === undefined
              ? ''
              : String(value);


          /*
          CSV escaping:
          - double quotes become ""
          - fields containing commas/newlines/quotes
            are wrapped in double quotes
          */

          if (
            text.includes(',') ||
            text.includes('"') ||
            text.includes('\n') ||
            text.includes('\r')
          ) {

            return `"${text.replace(/"/g, '""')}"`;

          }


          return text;

        })

        .join(',')

    )

    .join('\n');

}


/*
-----------------------------------------------------------
9. API HANDLER
-----------------------------------------------------------
*/

export default async function handler(req, res) {

  /*
  Prevent browser/CDN caching.
  */

  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
  );

  res.setHeader(
    'CDN-Cache-Control',
    'no-store'
  );

  res.setHeader(
    'Vercel-CDN-Cache-Control',
    'no-store'
  );

  res.setHeader(
    'Pragma',
    'no-cache'
  );


  /*
  Identify requested dataset.
  */

  const source =
    String(
      req.query?.source || ''
    ).toLowerCase();


  const gid =
    SHEET_GIDS[source];


  if (!gid) {

    return res.status(400).json({

      error:
        `Invalid source "${source}". Valid sources are: h2, hc, map, spill.`

    });

  }


  try {

    /*
    Create authenticated Google Sheets client.
    */

    const sheets =
      getSheetsClient();


    /*
    Read the requested Sheet tab.
    */

    const csv =
      await readSheetAsCSV(
        sheets,
        gid
      );


    /*
    Validate response.
    */

    if (
      !csv ||
      !csv.trim()
    ) {

      throw new Error(
        `Google Sheet returned an empty response for source "${source}".`
      );

    }


    /*
    Send CSV to existing dashboard.
    */

    res.setHeader(
      'Content-Type',
      'text/csv; charset=utf-8'
    );


    res.setHeader(
      'Access-Control-Allow-Origin',
      '*'
    );


    res.setHeader(
      'X-Google-Sheets-Source',
      source
    );


    res.setHeader(
      'X-Google-Sheets-GID',
      String(gid)
    );


    res.setHeader(
      'X-Google-Sheets-Fetched-At',
      new Date().toISOString()
    );


    return res
      .status(200)
      .send(csv);


  } catch (error) {

    console.error(
      `Google Sheets API error [${source}]:`,
      error
    );


    /*
    Try to give the dashboard a useful error message
    rather than simply "Refresh failed".
    */

    const message =
      error?.message ||
      'Unknown Google Sheets API error';


    return res.status(502).json({

      error:
        `${source}: ${message}`

    });

  }

}
