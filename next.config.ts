import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB; a full Delver Lens export (rules text, prices, etc.
      // per row) regularly runs several MB. 20MB comfortably covers a large
      // collection with headroom.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
