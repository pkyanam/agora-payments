import type { NextConfig } from 'next';
const apiOrigin = process.env.AGORA_API_ORIGIN?.replace(/\/$/, '');

if (process.env.VERCEL === '1' && !apiOrigin) {
  throw new Error('AGORA_API_ORIGIN must be set for hosted builds so API routes cannot fall back to local SQLite.');
}

if (apiOrigin) {
  const parsed = new URL(apiOrigin);
  const localHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (
    (parsed.protocol !== 'https:' && !localHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('AGORA_API_ORIGIN must be an HTTPS origin (or loopback HTTP for local development), without credentials or a path.');
  }
}

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ['agora.localhost'],
  async rewrites() {
    if (!apiOrigin) return [];
    return {
      beforeFiles: [
        {
          source: '/api/:path*',
          destination: `${apiOrigin}/api/:path*`,
        },
      ],
    };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default nextConfig;
