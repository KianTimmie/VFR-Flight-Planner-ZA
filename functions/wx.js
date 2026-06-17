// Cloudflare Pages Function: weather proxy.
// URL: /wx?type=metar&ids=FACT  (same origin as the app, so no browser CORS issue).
// Cloudflare maps functions/wx.js to the /wx path automatically.
// Runs server-side, so it can fetch aviationweather.gov (CORS doesn't apply
// server-to-server) and return the JSON with permissive headers.

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const type = (url.searchParams.get('type') === 'taf') ? 'taf' : 'metar';
  const ids = (url.searchParams.get('ids') || '').replace(/[^A-Za-z0-9,]/g, '');
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (!ids) {
    return new Response(JSON.stringify({ error: 'missing ids' }), { status: 400, headers: cors });
  }
  const api = 'https://aviationweather.gov/api/data/' + type +
    '?ids=' + encodeURIComponent(ids) + '&format=json';
  try {
    const r = await fetch(api, { headers: { 'Accept': 'application/json' } });
    const text = await r.text();
    return new Response(text, { status: r.status, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e && e.message) || e) }),
      { status: 502, headers: cors });
  }
}
