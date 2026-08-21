import { google } from 'googleapis';
import { requireDashboardSession } from './auth.js';

/*
===========================================================
H2 2026 MANPOWER PLANNING DASHBOARD
GOOGLE SHEETS API
===========================================================

Google Sheet:
https://docs.google.com/spreadsheets/d/1HCGPk1X5jhqeoBMIX_6j2ZnTj-d19nQDj-VdsmrW7u8/edit

The dashboard calls:

/api/sheets?source=h2
/api/sheets?source=hc
/api/sheets?source=map
/api/sheets?source=spill

The API reads the private Google Sheet using the
Google service account stored in Vercel Environment Variables.

===========================================================
*/


/*
-----------------------------------------------------------
1. GOOGLE SPREADSHEET ID
-----------------------------------------------------------

NEW PRODUCTION SHEET
-----------------------------------------------------------
*/

const SPREADSHEET_ID =
  '1HCGPk1X5jhqeoBMIX_6j2ZnTj-d19nQDj-VdsmrW7u8';


/*
-----------------------------------------------------------
2. GOOGLE SHEET TAB NAMES
-----------------------------------------------------------

IMPORTANT:

The dashboard's internal source name "h2" now points
to the "Master Data" tab.

The other three names must exactly match the Google
Sheet tab names.
-----------------------------------------------------------
*/

const SHEET_NAMES = {

  h2: 'Master Data',

  hc: 'Companywide HC',

  map: 'DEPT + Wing Name',

  spill: 'H1 FY26 Spillover'

};


/*
-----------------------------------------------------------
3. GOOGLE API SCOPE
-----------------------------------------------------------

The service account only needs READ access.
-----------------------------------------------------------
*/

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];


/*
-----------------------------------------------------------
4. CREATE GOOGLE AUTHENTICATION
-----------------------------------------------------------

The service-account credentials are NOT stored in GitHub.

They are stored in Vercel as:

GOOGLE_SERVICE_ACCOUNT_JSON

The value must contain the COMPLETE service-account JSON.
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
      'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Please paste the complete service-account JSON into Vercel.'
    );

  }


  /*
  Validate the two fields required by Google JWT auth.
  */

  if (!credentials.client_email) {

    throw new Error(
      'Service-account JSON is missing "client_email".'
    );

  }


  if (!credentials.private_key) {

    throw new Error(
      'Service-account JSON is missing "private_key".'
    );

  }


  /*
  Create authenticated Google JWT client.
  */

  return new google.auth.JWT({

    email:
      credentials.client_email,

    key:
      credentials.private_key,

    scopes:
      SCOPES

  });

}


/*
-----------------------------------------------------------
5. CREATE GOOGLE SHEETS CLIENT
-----------------------------------------------------------
*/

function getSheetsClient() {

  return google.sheets({

    version: 'v4',

    auth:
      getGoogleAuth()

  });

}


/*
-----------------------------------------------------------
6. FIND GOOGLE SHEET TAB BY NAME
-----------------------------------------------------------

We use the actual tab name rather than hard-coding the GID.

This makes the API easier to maintain.
-----------------------------------------------------------
*/

async function getSheetByName(
  sheets,
  sheetName
) {

  const response =
    await sheets.spreadsheets.get({

      spreadsheetId:
        SPREADSHEET_ID,

      fields:
        'spreadsheetId,properties.title,sheets.properties'

    });


  const sheetList =
    response.data.sheets || [];


  const matchingSheet =
    sheetList.find(

      sheet =>
        sheet.properties &&
        sheet.properties.title === sheetName

    );


  /*
  If the tab cannot be found, return the list of
  available tabs to make troubleshooting easier.
  */

  if (!matchingSheet) {

    const availableTabs =
      sheetList

        .map(
          sheet =>
            sheet.properties?.title
        )

        .filter(Boolean)

        .join(', ');


    throw new Error(

      `Google Sheet tab "${sheetName}" was not found. ` +
      `Available tabs: ${availableTabs}`

    );

  }


  return matchingSheet.properties;

}


/*
-----------------------------------------------------------
7. READ A GOOGLE SHEET TAB
-----------------------------------------------------------

Reads columns A:ZZ.

This gives the dashboard enough room if columns are
added later.
-----------------------------------------------------------
*/

async function readSheetAsCSV(
  sheets,
  sheetName
) {


  /*
  Confirm that the requested tab exists.
  */

  const properties =
    await getSheetByName(

      sheets,

      sheetName

    );


  /*
  Escape apostrophes if they ever appear in a tab name.
  */

  const escapedTitle =
    `'${properties.title.replace(/'/g, "''")}'`;


  /*
  Read the CURRENT values from Google Sheets.
  */

  const response =
    await sheets.spreadsheets.values.get({

      spreadsheetId:
        SPREADSHEET_ID,

      range:
        `${escapedTitle}!A:ZZ`,

      majorDimension:
        'ROWS',

      /*
      Use formatted values so dates and other displayed
      Sheet values are returned in a dashboard-friendly form.
      */

      valueRenderOption:
        'FORMATTED_VALUE'

    });


  const values =
    response.data.values || [];


  /*
  Empty-sheet check.
  */

  if (!values.length) {

    throw new Error(

      `Google Sheet tab "${sheetName}" returned no data.`

    );

  }


  /*
  Convert Google Sheets values to CSV.
  */

  return valuesToCSV(values);

}


/*
-----------------------------------------------------------
8. CONVERT GOOGLE SHEETS ARRAY TO CSV
-----------------------------------------------------------
*/

function valuesToCSV(values) {

  return values

    .map(row =>

      row

        .map(value => {

          /*
          Convert empty values to blank strings.
          */

          const text =

            value === null ||
            value === undefined

              ? ''

              : String(value);


          /*
          CSV escaping.

          Values containing:
          - comma
          - quotation mark
          - newline

          must be wrapped in quotes.
          */

          if (

            text.includes(',') ||
            text.includes('"') ||
            text.includes('\n') ||
            text.includes('\r')

          ) {

            return (

              '"' +
              text.replace(/"/g, '""') +
              '"'

            );

          }


          return text;

        })

        .join(',')

    )

    .join('\n');

}


/*
-----------------------------------------------------------
9. VERCEL API HANDLER
-----------------------------------------------------------
*/

export default async function handler(
  req,
  res
) {

  /*
  ---------------------------------------------------------
  REQUIRE AN AUTHENTICATED, AUTHORIZED DASHBOARD USER
  ---------------------------------------------------------
  The Google Sheets service-account credentials remain server-side.
  The browser must also present a valid authenticated NEXT Ventures
  dashboard session before any sheet data is returned.
  */

  try {
    requireDashboardSession(req);
  } catch (authError) {
    return res.status(authError.statusCode || 401).json({
      ok: false,
      error: 'Authentication required. Please sign in with an authorized NEXT Ventures Google account.'
    });
  }


  /*
  ---------------------------------------------------------
  DISABLE CACHING
  ---------------------------------------------------------

  This is critical for the Refresh button.

  We don't want the browser, CDN, or Vercel to return
  an old version of the Google Sheet data.
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
  ---------------------------------------------------------
  GET REQUESTED DATA SOURCE
  ---------------------------------------------------------
  */

  const source =

    String(
      req.query?.source || ''
    )

    .trim()

    .toLowerCase();


  /*
  Find the Google Sheet tab associated with the source.
  */

  const sheetName =
    SHEET_NAMES[source];


  /*
  ---------------------------------------------------------
  VALIDATE SOURCE
  ---------------------------------------------------------
  */

  if (!sheetName) {

    return res

      .status(400)

      .json({

        ok: false,

        error:
          `Invalid source "${source}". ` +
          `Valid sources are: h2, hc, map, spill.`

      });

  }


  try {


    /*
    -------------------------------------------------------
    CONNECT TO GOOGLE SHEETS
    -------------------------------------------------------
    */

    const sheets =
      getSheetsClient();


    /*
    -------------------------------------------------------
    FETCH LIVE DATA
    -------------------------------------------------------
    */

    const csv =
      await readSheetAsCSV(

        sheets,

        sheetName

      );


    /*
    Make sure actual data was returned.
    */

    if (!csv || !csv.trim()) {

      throw new Error(

        `Google Sheet tab "${sheetName}" returned empty data.`

      );

    }


    /*
    -------------------------------------------------------
    RESPONSE HEADERS
    -------------------------------------------------------
    */

    res.setHeader(

      'Content-Type',

      'text/csv; charset=utf-8'

    );

    // No wildcard CORS header: the sheet data endpoint is intentionally
    // same-origin and requires an authenticated dashboard session.


    /*
    Diagnostic headers.
    These are useful when troubleshooting without
    opening Developer Tools.
    */

    res.setHeader(

      'X-Sheets-Source',

      source

    );


    res.setHeader(

      'X-Sheets-Tab',

      sheetName

    );


    res.setHeader(

      'X-Sheets-Fetched-At',

      new Date().toISOString()

    );


    /*
    -------------------------------------------------------
    RETURN LIVE CSV DATA
    -------------------------------------------------------
    */

    return res

      .status(200)

      .send(csv);


  } catch (error) {


    /*
    -------------------------------------------------------
    ERROR HANDLING
    -------------------------------------------------------
    */

    console.error(

      `Google Sheets API error [${source}]:`,

      error

    );


    const message =

      error?.message ||

      'Unknown Google Sheets API error';


    /*
    Return the actual error to the browser.

    This makes troubleshooting much easier because
    opening /api/sheets?source=h2 will show the reason.
    */

    return res

      .status(502)

      .json({

        ok: false,

        source:
          source,

        sheet:
          sheetName,

        error:
          message,

        timestamp:
          new Date().toISOString()

      });

  }

}
