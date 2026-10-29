# Kulhi's website

The public site for Kulhi (the Desk Companion app). Vite + TypeScript, no framework. The characters on the page are the app's own: the site imports the character engine and skins from `../src` (the `@app` alias in `vite.config.ts`), so they look and move exactly as on the desktop.

```bash
cd web
npm install
npm run dev       # http://localhost:5190
npm run build     # type-check, then the static site in web/dist
npm run preview   # serve web/dist
```

## Deploying

Any static host works; the output is `web/dist`.

**Vercel:** import the repository, set **Root Directory** to `web`, and keep **Include files outside the root directory in the Build Step** on (it's on by default; the site needs `../src`). Vercel detects Vite: build `npm run build`, output `dist`. Pick the branch to deploy from in the project's Git settings.

**Netlify / Cloudflare Pages:** base directory `web`, build command `npm run build`, publish directory `web/dist`.

## Search engines, link previews, analytics

- **Your domain:** any domain works. On Vercel the build uses the project's production domain by itself (`VERCEL_PROJECT_PRODUCTION_URL`: your own domain once it's added under Settings → Domains, else the `vercel.app` address), for the canonical link, the link-preview tags, the structured data, `robots.txt` and `sitemap.xml`. Redeploy after adding a domain. To force an address (another host, or a domain other than the main one), set `VITE_SITE_URL`, for example `https://kulhi.app`. With neither, the site assumes `https://kulhi.vercel.app`.
- **Google Search Console:** add the site, pick the "HTML tag" check, and put its code in `VITE_GOOGLE_SITE_VERIFICATION`; the next deploy carries the tag. Then submit `<your domain>/sitemap.xml`.
- **Analytics:** Vercel Web Analytics (no cookies). Turn it on in the Vercel project (Analytics tab); the page already sends page views when it runs there, and nothing in local dev.
- **Link previews:** `public/og.png` (1200x630) is a capture of the hero. Retake it after the hero changes.

## What's where

| File | What |
|---|---|
| `index.html` | All the sections and copy, the page's metadata and structured data |
| `src/style.css` | The look: one day's painted sky, scene by scene, the pretend desk, storyboard frames, the crew's stage |
| `src/main.ts` | Live characters (eyes follow, click to say hello, doze at night), the nav's colour script, analytics |
| `src/demo.ts` | The pretend agent whose permission card you answer |
| `src/links.ts` | GitHub links, and the downloads pointing at the newest installer and Android app on GitHub Releases |
| `vite.config.ts` | The `@app` alias, and the absolute addresses, `robots.txt` and `sitemap.xml` |
| `public/` | Icons, the link-preview image, the web manifest |
