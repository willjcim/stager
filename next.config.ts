// next config wraps with workflow plugin so workflows can be discovered and bundled
import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.zillowstatic.com" },
      { protocol: "https", hostname: "i.pinimg.com" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ],
  },
};

export default withWorkflow(nextConfig);
