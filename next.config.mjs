function normalizeRemoteApiOrigin(value) {
  const raw = (value || "").trim().replace(/\/+$/, "");
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

const remoteApiOrigin = normalizeRemoteApiOrigin(process.env.CLIPS_REMOTE_API_ORIGIN);

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
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
  ],
  async headers() {
    const securityHeaders = [
      {
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob: https:; " +
          "media-src 'self' blob: https:; " +
          "connect-src 'self' https: ws: wss:; " +
          "font-src 'self' data:; " +
          "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }
    ];

    return [
      {
        source: "/:path*",
        headers: securityHeaders
      }
    ];
  },
  async rewrites() {
    if (!remoteApiOrigin) {
      return [];
    }
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${remoteApiOrigin}/api/:path*`
        },
        {
          source: "/stage3-worker/:path*",
          destination: `${remoteApiOrigin}/stage3-worker/:path*`
        }
      ]
    };
  }
};

export default nextConfig;
