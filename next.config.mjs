/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    "@remotion/renderer",
    "@remotion/bundler",
    "@rspack/core",
    "@rspack/binding",
    "remotion"
  ]
};

export default nextConfig;
