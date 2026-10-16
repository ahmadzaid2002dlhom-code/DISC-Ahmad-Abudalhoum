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
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiOrigin.origin}/api/:path*` }];
  },
};

export default config;
