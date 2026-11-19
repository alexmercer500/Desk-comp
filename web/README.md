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
- **Structured data:** the app and the site are written by hand in `index.html`. The FAQ (from the `<details>` in the questions section) and the demo video (from the `data-film` video) are added at build time by `vite.config.ts`, so they always match the page. Change the video's `uploadDate` and `duration` there if the recording is replaced.
- **Analytics:** Vercel Web Analytics and Speed Insights (no cookies). They only send from the deployed site. After switching either on in the Vercel project, redeploy once, or its script stays at 404.
- **Link previews:** `public/og.png` (1200x630) is a capture of the hero headline over the desk demo. Retake it after the hero changes.

## What's where

| File | What |
|---|---|
| `index.html` | All the sections and copy, the page's metadata and structured data |
| `src/style.css` | The look: warm paper, ink and one clay accent (light and dark), a ruled frame with numbered sections, the pretend desk, the crew's cells |
| `src/main.ts` | Live characters (eyes follow, click to say hello, one dozes beside the phone), analytics |
| `src/theme.ts` | Light or dark: follows the system until the visitor picks one with the nav's button, and remembers it |
| `src/demo.ts` | The pretend agent whose permission card you answer |
| `src/links.ts` | GitHub links, and the downloads pointing at the newest installer and Android app on GitHub Releases |
| `vite.config.ts` | The `@app` alias, and the absolute addresses, `robots.txt` and `sitemap.xml` |
| `public/` | Icons, the link-preview image, the web manifest |
