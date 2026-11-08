import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next build` (verify) and `next dev` share .next by default; a build clobbers the dev server's
  // chunk manifests and every page goes unstyled. Give dev its own distDir so the two coexist.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};

export default nextConfig;
