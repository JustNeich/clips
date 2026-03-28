/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Leave headroom above the 80MB music file limit for multipart boundaries and field headers.
    middlewareClientMaxBodySize: 90 * 1024 * 1024
  },
  serverExternalPackages: [
    "@remotion/renderer",
    "@remotion/bundler",
    "@rspack/core",
    "@rspack/binding",
    "remotion"
  ]
};

export default nextConfig;
