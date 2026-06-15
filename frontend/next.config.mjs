/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) for a small Docker image.
  output: "standalone",
  // Keep nodemailer (Node-only, with optional deps) out of the bundler so the
  // /api/circle-email route loads it from node_modules at runtime instead.
  serverExternalPackages: ["nodemailer"],
  // snarkjs (browser ZK proving) references Node built-ins it doesn't use in the
  // browser — stub them so the client bundle builds.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false, readline: false, path: false, os: false, crypto: false, stream: false, constants: false,
      };
    }
    return config;
  },
};
export default nextConfig;
