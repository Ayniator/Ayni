/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) for a small Docker image.
  output: "standalone",
  // Keep nodemailer (Node-only, with optional deps) out of the bundler so the
  // /api/circle-email route loads it from node_modules at runtime instead.
  serverExternalPackages: ["nodemailer"],
};
export default nextConfig;
