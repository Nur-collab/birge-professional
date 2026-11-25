import { ipAddress, next } from '@vercel/functions';

/**
 * Vercel rewrites to external origins forward caller-supplied X-Forwarded-For
 * values. Resolve the edge-sanitized visitor address inside the middleware and
 * pass it to the origin in a header that the rewrite cannot overwrite.
 */
export default function proxy(request) {
  const headers = new Headers(request.headers);
  headers.set('x-auth-client-ip', ipAddress(request) ?? '');
  return next({ request: { headers } });
}
