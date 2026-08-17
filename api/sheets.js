import { google } from 'googleapis';

/*
===========================================================
H2 MANPOWER DASHBOARD
PRIVATE GOOGLE SHEETS API
===========================================================

This API reads the private Google Sheet through a
Google service account.

The dashboard calls:

/api/sheets?source=h2
/api/sheets?source=hc
/api/sheets?source=map
/api/sheets?source=spill

The response is returned as CSV so the existing
index.html/dashboard can continue using the same
data-processing logic.

===========================================================
*/


/*
-----------------------------------------------------------
1. GOOGLE SPREADSHEET ID
-----------------------------------------------------------

Google Sheet:

https://docs.google.com/spreadsheets/d/
1ee3ujtOuQH9_3WSAwn5Yr7aruPg2Bz99BhhPlBGD6-A/edit

Only the Spreadsheet ID is required here.
-----------------------------------------------------------
*/

const SPREADSHEET_ID =
  '1ee3ujtOuQH9_3WSAwn5Yr7aruPg2Bz99BhhPlBGD6-A';


/*
-----------------------------------------------------------
2. EXACT GOOGLE SHEET TAB NAMES
-----------------------------------------------------------

These names MUST match the tabs in your Google Sheet.

Current tabs:

H2 FY26 Plan
Companywide HC
DEPT + Wing Name
H1 FY26 Spillover
-----------------------------------------------------------
*/

const SHEET_NAMES = {

  h2: 'H2 FY26 Plan',

  hc: 'Companywide HC',

  map: 'DEPT + Wing Name',

  spill: 'H1 FY26 Spillover'

};


/*
-----------------------------------------------------------
3. GOOGLE SHEETS API PERMISSION
-----------------------------------------------------------

Read-only access is sufficient.

The service account only needs to VIEW the spreadsheet.
-----------------------------------------------------------
*/

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];


/*
-----------------------------------------------------------
4. CREATE GOOGLE AUTHENTICATION
-----------------------------------------------------------

IMPORTANT:

The service-account credentials are NOT stored in this
file.

They are stored in Vercel as:

GOOGLE_SERVICE_ACCOUNT_JSON

Example Vercel setup:

Key:
GOOGLE_SERVICE_ACCOUNT_JSON

Value:
[the COMPLETE service-account JSON]

Do NOT upload the JSON file to GitHub.
-----------------------------------------------------------
*/

function getGoogleAuth() {

  const rawCredentials =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;


  if (!rawCredentials) {

    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is missing from Vercel Environment Variables.'
    );

  }


  let credentials;


  try {

    credentials =
      JSON.parse(rawCredentials);

  } catch (error) {

    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Make sure you pasted the complete service-account JSON into Vercel.'
    );

  }


  /*
  Check required service-account fields.
  */

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
  Create JWT authentication.
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
6. FIND A TAB BY ITS NAME
-----------------------------------------------------------

We intentionally use the tab name instead of the GID.

This is safer because the GID does not need to be
maintained in the dashboard code.

If you rename a tab in the future, update SHEET_NAMES above.
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


  const sheetsList =
    response.data.sheets || [];


  const matchingSheet =
    sheetsList.find(

      sheet =>
        sheet.properties &&
        sheet.properties.title === sheetName

    );


  /*
  If the tab doesn't exist, provide a useful error
  including the actual available tab names.
  */

  if (!matchingSheet) {

    const availableTabs =
      sheetsList

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
7. READ GOOGLE SHEET TAB
-----------------------------------------------------------

Reads columns A through ZZ.

This gives enough room for the current manpower data
while allowing the Sheet to expand horizontally later.
-----------------------------------------------------------
*/

async function readSheetAsCSV(
  sheets,
  sheetName
) {


  /*
  First confirm that the tab exists.
  */

  const properties =
    await getSheetByName(

      sheets,

      sheetName

    );


  /*
  Escape apostrophes in tab names.

  Example:

  John's Data

  becomes:

  'John''s Data'
  */

  const escapedTitle =
    `'${properties.title.replace(/'/g, "''")}'`;


  /*
  Read the current values directly from Google Sheets.
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
      Use displayed/ formatted values so dates and
      existing Sheet formatting are returned in a
      dashboard-friendly format.
      */

      valueRenderOption:
        'FORMATTED_VALUE'

    });


  const values =
    response.data.values || [];


  /*
  Empty sheet check.
  */

  if (!values.length) {

    throw new Error(

      `Google Sheet tab "${sheetName}" returned no data.`

    );

  }


  /*
  Convert the Google Sheets array into CSV.
  */

  return valuesToCSV(values);

}


/*
-----------------------------------------------------------
8. GOOGLE SHEETS VALUES → CSV
-----------------------------------------------------------
*/

function valuesToCSV(values) {

  return values

    .map(row =>

      row

        .map(value => {

          /*
          Convert null / undefined to blank.
          */

          const text =

            value === null ||
            value === undefined

              ? ''

              : String(value);


          /*
          CSV requires fields containing:

          ,
          "
          line breaks

          to be wrapped in quotes.
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
  PREVENT CACHING
  ---------------------------------------------------------

  This is important for your Refresh button.

  We don't want Vercel/browser/CDN to return an old
  Google Sheet response.
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
  GET REQUESTED SOURCE
  ---------------------------------------------------------
  */

  const source =

    String(
      req.query?.source || ''
    )

    .trim()

    .toLowerCase();


  /*
  Find the corresponding Sheet tab.
  */

  const sheetName =
    SHEET_NAMES[source];


  /*
  Validate source.
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
    CREATE AUTHENTICATED GOOGLE SHEETS CLIENT
    -------------------------------------------------------
    */

    const sheets =
      getSheetsClient();


    /*
    -------------------------------------------------------
    READ LIVE GOOGLE SHEET DATA
    -------------------------------------------------------
    */

    const csv =
      await readSheetAsCSV(

        sheets,

        sheetName

      );


    /*
    Make sure data was actually returned.
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


    res.setHeader(

      'Access-Control-Allow-Origin',

      '*'

    );


    /*
    Useful diagnostic headers.
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
    RETURN LIVE DATA
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
    Return the actual reason to the browser.

    This means if something fails, you can open:

    /api/sheets?source=h2

    and see the error without needing Developer Tools.
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
