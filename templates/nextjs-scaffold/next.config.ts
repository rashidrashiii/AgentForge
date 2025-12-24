import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Set turbopack root to prevent directory traversal to .Trash and other restricted folders
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
