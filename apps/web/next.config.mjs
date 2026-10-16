import '../../scripts/load-env.mjs';

const apiOrigin = new URL(process.env.API_ORIGIN ?? 'http://localhost:4000');
if (!['http:', 'https:'].includes(apiOrigin.protocol) ||
    apiOrigin.username || apiOrigin.password || apiOrigin.search || apiOrigin.hash ||
    apiOrigin.pathname !== '/') {
  throw new Error('API_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment.');
}

/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  // Development access logs would otherwise print invitation tokens in paths.
  logging: { incomingRequests: false },
  async headers() {
    return ['/login', '/invite/:path*', '/assessment', '/result', '/staff/:path*', '/facilitator', '/manager'].map(source => ({ source, headers: [
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
    ] }));
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin.origin}/api/:path*` }];
  },
};

export default config;
