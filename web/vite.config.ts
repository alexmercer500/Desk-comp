import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

// The website. It draws the app's own characters, so `@app` points at the
// app's source one folder up (Vercel: Root Directory `web`, with files outside
// it included in the build, which is its default).

/** Where the site lives once deployed, when nothing says otherwise. */
const DEFAULT_SITE = "https://kulhi.vercel.app";

/** Fills the page's absolute addresses, and writes robots.txt and sitemap.xml for search engines. */
function seo(site: string, verify: string): Plugin {
  const verifyTag = verify ? `    <meta name="google-site-verification" content="${verify}" />\n` : "";
  return {
    name: "kulhi-seo",
    transformIndexHtml: (html) => html.replaceAll("%SITE%", site).replace("%VERIFY%\n", verifyTag),
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: "asset", fileName: "robots.txt", source: `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n` });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          `  <url><loc>${site}/</loc><lastmod>${today}</lastmod></url>`,
          `</urlset>`,
          ``,
        ].join("\n"),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, import.meta.dirname, "VITE_") };
  // VITE_SITE_URL wins; on Vercel, the project's production domain (your own
  // domain once you add one, else its vercel.app address) is used by itself.
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
  const site = (env.VITE_SITE_URL || vercel || DEFAULT_SITE).replace(/\/+$/, "");
  return {
    plugins: [seo(site, env.VITE_GOOGLE_SITE_VERIFICATION ?? "")],
    resolve: { alias: { "@app": resolve(import.meta.dirname, "../src") } },
    server: { port: 5190, strictPort: true, fs: { allow: [".."] } },
    build: { target: "es2022" },
  };
});
