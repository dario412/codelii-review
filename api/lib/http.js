export function corsHeaders(methods = 'GET, POST, PATCH, DELETE, OPTIONS') {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(),
  });
}

export function corsOptions(methods) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(methods),
  });
}
