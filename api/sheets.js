const SOURCES = {
  h2: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=1991353397&single=true&output=csv',
  hc: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=1767679898&single=true&output=csv',
  map: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=151350972&single=true&output=csv',
  spill: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRhe6yD0K2eA_KW0-kpOQ1GEA1zaTy6L3LbLwII891icFwRm7UF-lApnenX2dY58N0KGGJcsXsylVX1/pub?gid=208597519&single=true&output=csv'
};

export default async function handler(req, res) {
  const source = String(req.query?.source || '').toLowerCase();
  const url = SOURCES[source];
  if (!url) return res.status(400).json({ error: 'Invalid source' });

  try {
    const upstream = await fetch(url, { cache: 'no-store' });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: `Google Sheets returned HTTP ${upstream.status}` });
    }
    const csv = await upstream.text();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(csv);
  } catch (error) {
    console.error('Google Sheets proxy error:', error);
    return res.status(502).json({ error: 'Unable to retrieve Google Sheets data' });
  }
}
