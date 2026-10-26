import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["xlsx", "unpdf"],
};

export default nextConfig;
