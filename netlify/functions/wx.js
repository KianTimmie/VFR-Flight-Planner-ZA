// Netlify serverless function: weather proxy.
// The browser calls /.netlify/functions/wx?type=metar&ids=FACT  (same origin, no CORS).
// This function fetches from aviationweather.gov server-side (no CORS rules apply
// server-to-server) and returns the JSON with permissive CORS headers.

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const type = (params.type === 'taf') ? 'taf' : 'metar';
  const ids = (params.ids || '').replace(/[^A-Za-z0-9,]/g, ''); // sanitise
  if (!ids) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'missing ids' }) };
  }
  const url = 'https://aviationweather.gov/api/data/' + type + '?ids=' + encodeURIComponent(ids) + '&format=json';
  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const text = await r.text();
    return {
      statusCode: r.status,
      headers: Object.assign({ 'Content-Type': 'application/json' }, cors()),
      body: text,
    };
  } catch (e) {
    return { statusCode: 502, headers: cors(), body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}
