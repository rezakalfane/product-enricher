import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native and Node-only modules that must not be bundled into the server build.
  serverExternalPackages: ['@libsql/client', 'pdf-parse', 'tesseract.js'],
  // Tesseract spawns its worker script and picks a WASM core at runtime, so static tracing
  // can't see them; the language data is read from ocr/ instead of downloaded.
  outputFileTracingIncludes: {
    '/api/analyze': [
      './ocr/eng.traineddata',
      './node_modules/tesseract.js/src/**/*',
      './node_modules/tesseract.js-core/*.{js,wasm,json}',
      './node_modules/{wasm-feature-detect,zlibjs,bmp-js}/**/*',
    ],
  },
  images: { remotePatterns: [{ protocol: 'https', hostname: 'cdn11.bigcommerce.com' }] },
};

export default nextConfig;
