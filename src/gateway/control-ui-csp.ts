export function buildControlUiCspHeader(allowedOrigins?: string[]): string {
  const frameAncestors =
    allowedOrigins && allowedOrigins.length > 0
      ? `frame-ancestors ${allowedOrigins.join(" ")}`
      : "frame-ancestors 'none'";
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    frameAncestors,
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
  ].join("; ");
}
