import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

// The website. It draws the app's own characters, so `@app` points at the
// app's source one folder up (Vercel: Root Directory `web`, with files outside
// it included in the build, which is its default).

/** Where the site lives once deployed, when nothing says otherwise. */
const DEFAULT_SITE = "https://kulhi.vercel.app";

/** Plain text from a bit of the page's HTML: tags dropped, entities and spaces tidied. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Structured data built from the page itself at build time, so it can't drift
 * from what visitors read: the FAQ (from the <details> in the questions
 * section) and the demo video (from the data-film <video>).
 */
function structured(html: string, site: string): string {
  const graph: object[] = [];
  const faq = [...html.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({
    "@type": "Question",
    name: text(m[1]),
    acceptedAnswer: { "@type": "Answer", text: text(m[2]) },
  }));
  if (faq.length) graph.push({ "@type": "FAQPage", mainEntity: faq });
  const video = /<video\b[^>]*data-film[\s\S]*?<\/video>/.exec(html)?.[0];
  if (video) {
    const label = /aria-label="([^"]+)"/.exec(video)?.[1] ?? "";
    const poster = /poster="([^"]+)"/.exec(video)?.[1];
    const mp4 = /<source src="([^"]+\.mp4)"/.exec(video)?.[1];
    graph.push({
      "@type": "VideoObject",
      name: "Kulhi answering Claude Code's permission prompt on Windows",
      description: label,
      thumbnailUrl: poster && `${site}${poster}`,
      contentUrl: mp4 && `${site}${mp4}`,
      uploadDate: "2026-11-19",
      duration: "PT25S",
    });
  }
  if (!graph.length) return "";
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2).replace(/</g, "\\u003c");
  return `    <script type="application/ld+json">\n${json}\n    </script>\n  </head>`;
}

/** Fills the page's absolute addresses, and writes robots.txt and sitemap.xml for search engines. */
function seo(site: string, verify: string): Plugin {
  const verifyTag = verify ? `    <meta name="google-site-verification" content="${verify}" />\n` : "";
  return {
    name: "kulhi-seo",
    transformIndexHtml: (html) => {
      const filled = html.replaceAll("%SITE%", site).replace(/%VERIFY%[\r\n]+/, verifyTag);
      const extra = structured(filled, site);
      return extra ? filled.replace(/\s*<\/head>/, `\n${extra}`) : filled;
    },
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
