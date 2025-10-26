import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    devIndicators: false,
    turbopack: {
        /**
         * Force Turbopack to treat this directory as the workspace root.
         * Prevents it from walking up to /Users/dharris where dependencies may be missing.
         */
        root: __dirname,
    },
  /* config options here */
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'i.ibb.co',
                port: '',
                pathname: '/**',
            },
        ],
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
    typescript: {
        ignoreBuildErrors: true,
    }
};

export default nextConfig;
