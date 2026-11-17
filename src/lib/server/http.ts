export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function apiError(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'local';
}
