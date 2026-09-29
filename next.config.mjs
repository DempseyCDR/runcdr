/**
 * Dev tunnel: when the dev server is reached through another address — an ngrok tunnel, so a phone can
 * test it — Next.js refuses that address its development files unless it is listed here. Kept in `.env`
 * (DEV_ALLOWED_ORIGINS, comma-separated host names) so a personal tunnel address never enters the code.
 * Affects `next dev` only.
 */
const allowedDevOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins,
};

export default nextConfig;
