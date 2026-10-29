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

## What's where

| File | What |
|---|---|
| `index.html` | All the sections and copy |
| `src/style.css` | The look: lid colours, die-cut sticker borders, the pretend desk, labels |
| `src/main.ts` | Live stickers (poke, peel and drop), only drawing while on screen |
| `src/demo.ts` | The pretend agent whose permission card you answer |
| `src/links.ts` | GitHub links, and the download button pointing at the newest installer on GitHub Releases |

The download button asks GitHub for the latest release of `alexmercer500/Desk-comp-releases` and links its `x64-setup.exe`; if GitHub can't be reached it stays on the latest-release page. When the code repository is renamed or moved, change `REPO` in `src/links.ts` and the links in `index.html`.
