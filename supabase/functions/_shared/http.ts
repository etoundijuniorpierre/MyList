export function corsHeaders(request: Request) {
  const origin = request.headers.get('origin')
  const allowed = new Set(['https://mylist-rho.vercel.app', 'http://localhost:5173', ...(Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)])
  return origin && allowed.has(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  } : {}
}

export function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request) } })
}

export function originAllowed(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  return new Set(['https://mylist-rho.vercel.app', 'http://localhost:5173', ...(Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)]).has(origin)
}
