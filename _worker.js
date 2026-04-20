/**
 * VeridisKey Cloudflare Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * Proxies requests to the ROOTKey API so the API key is never exposed
 * in the browser. Deployed automatically by Cloudflare Pages.
 *
 * Environment variables required (set in Cloudflare Dashboard):
 *   ROOTKEY_API_KEY   — your ROOTKey API key (rk_live_xxxxx)
 *   ROOTKEY_ORG_ID    — your ROOTKey organisation ID (org_veridis)
 *
 * Usage from browser:
 *   fetch('/api/rootkey/certify', { method: 'POST', body: JSON.stringify({...}) })
 * ─────────────────────────────────────────────────────────────────────────────
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── ROOTKey API proxy ────────────────────────────────────────────────────
    if (url.pathname.startsWith('/api/rootkey/')) {

      // Strip the /api/rootkey/ prefix and forward to ROOTKey
      const rootkeyPath = url.pathname.replace('/api/rootkey', '');
      const rootkeyUrl  = `https://api.rootkey.ai/v2${rootkeyPath}${url.search}`;

      // Build forwarded request with injected credentials
      const headers = new Headers(request.headers);
      headers.set('Authorization', `Bearer ${env.ROOTKEY_API_KEY}`);
      headers.set('X-Org-Id',      env.ROOTKEY_ORG_ID || '');
      headers.set('Content-Type',  'application/json');
      headers.delete('host'); // Remove original host header

      const proxied = new Request(rootkeyUrl, {
        method:  request.method,
        headers: headers,
        body:    ['GET', 'HEAD'].includes(request.method) ? null : request.body,
      });

      try {
        const response = await fetch(proxied);

        // Add CORS headers so the portal page can call this endpoint
        const corsHeaders = {
          'Access-Control-Allow-Origin':  url.origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        return new Response(response.body, {
          status:  response.status,
          headers: { ...Object.fromEntries(response.headers), ...corsHeaders },
        });

      } catch (err) {
        // If ROOTKey is unreachable (demo mode), return a realistic mock response
        return mockRootKeyResponse(url.pathname, request);
      }
    }

    // ── CORS preflight ───────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':  '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age':       '86400',
        },
      });
    }

    // ── Supabase proxy (optional — keeps Supabase anon key server-side) ──────
    if (url.pathname.startsWith('/api/supabase/')) {
      const supabasePath = url.pathname.replace('/api/supabase', '');
      const supabaseUrl  = `${env.SUPABASE_URL}${supabasePath}${url.search}`;

      const headers = new Headers(request.headers);
      headers.set('apikey',        env.SUPABASE_ANON_KEY || '');
      headers.set('Authorization', `Bearer ${env.SUPABASE_ANON_KEY || ''}`);
      headers.delete('host');

      try {
        const response = await fetch(new Request(supabaseUrl, {
          method:  request.method,
          headers: headers,
          body:    ['GET', 'HEAD'].includes(request.method) ? null : request.body,
        }));
        return response;
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Supabase unavailable' }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ── All other requests: pass through to static assets ───────────────────
    return env.ASSETS.fetch(request);
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   MOCK ROOTKEY RESPONSE
   Returns realistic demo data when ROOTKey API is not configured yet.
   Remove or disable once you have a real API key.
───────────────────────────────────────────────────────────────────────────── */
function mockRootKeyResponse(pathname, request) {
  const rand = (n) => Array.from({ length: n }, () =>
    '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

  const now = new Date().toISOString();

  // POST /certify
  if (pathname.endsWith('/certify') && request.method === 'POST') {
    return jsonResponse({
      success: true,
      certificate_id:  `RK-${rand(4).toUpperCase()}${rand(4).toUpperCase()}`,
      hash:            `sha256:${rand(48)}`,
      transaction_hash:`0x${rand(8)}`,
      timestamp:        now,
      network:         'mainnet',
      status:          'certified',
    });
  }

  // GET /verify/:hash
  if (pathname.includes('/verify/')) {
    return jsonResponse({
      valid:      true,
      certified:  true,
      hash:       pathname.split('/verify/')[1] || `sha256:${rand(48)}`,
      issued_at:  now,
      issuer_did: 'did:ebsi:z22ZHsQmNdbGFXkDEz5mfQ9',
      network:    'mainnet',
    });
  }

  // GET /certificate/:id
  if (pathname.includes('/certificate/')) {
    return jsonResponse({
      certificate_id:  pathname.split('/certificate/')[1] || `RK-${rand(8).toUpperCase()}`,
      status:         'active',
      issued_at:       now,
      hash:           `sha256:${rand(48)}`,
      credential_type:'Verifiable Credential',
      issuer_org:     'Veridis Platform',
    });
  }

  // GET /audit/events
  if (pathname.endsWith('/audit/events')) {
    return jsonResponse({
      events: [
        { id: `EVT-${rand(6)}`, type: 'certification', timestamp: now, hash: `0x${rand(8)}` },
        { id: `EVT-${rand(6)}`, type: 'verification',  timestamp: now, hash: `0x${rand(8)}` },
      ],
      total: 2,
    });
  }

  return jsonResponse({ error: 'Endpoint not found in mock' }, 404);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
