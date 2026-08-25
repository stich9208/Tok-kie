const path = require('node:path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  // Electron development loads the renderer from the loopback server while
  // the packaged app uses app://tokkie. Keep this allowlist dev-only; it has
  // no effect on the static production export.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },
}

module.exports = nextConfig
