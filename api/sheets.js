const SOURCES = {
  h2: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=1991353397&single=true&output=csv',
  hc: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=1767679898&single=true&output=csv',
  map: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=151350972&single=true&output=csv',
  spill: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=208597519&single=true&output=csv'
};

export default async function handler(req, res) {
  const source = String(req.query?.source || '').toLowerCase();
  const url = SOURCES[source];

  if (!url) {
    return res.status(400).json({ error: 'Invalid source' });
  }

  // IMPORTANT:
  // Do NOT append arbitrary cache-busting query parameters to Google's
  // published /pub CSV URL. Google can reject modified Publish-to-web URLs.
  // The dashboard itself cache-busts /api/sheets, while this proxy asks
  // Google for the exact published CSV URL.
  const fetchUpstream = async () => fetch(url, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      'Pragma': 'no-cache',
      'Accept': 'text/csv,text/plain,*/*'
    }
  });

  try {
    let upstream = await fetchUpstream();

    // A short retry helps with transient Google/Vercel upstream failures.
    if (!upstream.ok) {
      await new Promise(resolve => setTimeout(resolve, 700));
      upstream = await fetchUpstream();
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return res.status(502).json({
        error: `${source}: Google Sheets returned HTTP ${upstream.status}${detail ? ` — ${detail.slice(0, 180)}` : ''}`
      });
    }

    const csv = await upstream.text();

    if (!csv || !csv.trim()) {
      return res.status(502).json({
        error: `${source}: Google Sheets returned an empty response.`
      });
    }

    // Google can sometimes return an HTML error page instead of CSV.
    const trimmed = csv.trimStart().toLowerCase();
    if (
      trimmed.startsWith('<!doctype html') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('<head')
    ) {
      return res.status(502).json({
        error: `${source}: Google Sheets returned HTML instead of CSV. Check Publish to web / CSV access.`
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
    console.error(`Google Sheets proxy error [${source}]:`, error);
    return res.status(502).json({
      error: `${source}: Unable to retrieve Google Sheets data. ${error?.message || 'Unknown error'}`
    });
  }
}
