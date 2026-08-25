import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Isolated verification builds can opt into their own output directory so
  // an already-running local preview cannot corrupt or block the build.
  distDir: process.env.OMNIX_NEXT_DIST_DIR ?? '.next',
  // Vercel uploads this package as the deployment root. Tracing above that
  // directory makes Next construct a duplicated /vercel/path0 path. Local
  // monorepo builds still trace from the repository root.
  outputFileTracingRoot: process.env.VERCEL
    ? __dirname
    : path.join(__dirname, '../..'),
  outputFileTracingIncludes: {
    '/contacts/import': [
      './lib/application/workbook-parser-worker.mjs',
      './node_modules/xlsx/**/*',
    ],
  },
  images: {
    qualities: [90, 92],
  },
  experimental: {
    // XLS/XLSX imports accept 10 MB. Binary workbooks travel as base64, which
    // adds roughly 34% plus Server Action metadata. The parser still enforces
    // the strict 10 MB workbook bound independently.
    serverActions: { bodySizeLimit: '15mb' },
  },
};

export default nextConfig;
