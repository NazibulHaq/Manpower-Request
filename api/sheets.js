const SOURCES = {
  h2: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=1991353397&single=true&output=csv',
  hc: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=1767679898&single=true&output=csv',
  map: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=151350972&single=true&output=csv',
  spill: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=208597519&single=true&output=csv'
};

export default async function handler(req, res) {
  const source = String(req.query?.source || '').toLowerCase();
  const baseUrl = SOURCES[source];

  if (!baseUrl) {
    return res.status(400).json({ error: 'Invalid source' });
  }

  try {
    // IMPORTANT: add a cache-busting parameter to the Google Sheets URL itself.
    // The browser already cache-busts /api/sheets, but without this parameter
    // the Vercel function could still receive a cached Google CSV response.
    const googleUrl = new URL(baseUrl);
    googleUrl.searchParams.set('_dashboard_refresh', String(Date.now()));

    const upstream = await fetch(googleUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, max-age=0',
        'Pragma': 'no-cache'
      }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Google Sheets returned HTTP ${upstream.status}`
      });
    }

    const csv = await upstream.text();

    if (!csv || !csv.trim()) {
      return res.status(502).json({
        error: 'Google Sheets returned an empty response'
      });
    }

    // If the Google publication is unavailable or incorrectly configured,
    // Google can sometimes return an HTML page instead of CSV. Detect that
    // explicitly so the dashboard does not treat it as valid data.
    const trimmed = csv.trimStart().toLowerCase();
    if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
      return res.status(502).json({
        error: 'Google Sheets did not return CSV. Check that the sheet is published to the web.'
      });
    }

    const fetchedAt = new Date().toISOString();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Google-Sheets-Fetched-At', fetchedAt);
    res.setHeader('X-Google-Sheets-Source', source);

    return res.status(200).send(csv);
  } catch (error) {
    console.error('Google Sheets proxy error:', error);
    return res.status(502).json({
      error: `Unable to retrieve Google Sheets data: ${error?.message || 'Unknown error'}`
    });
  }
}
