// Where the buttons go. The download points at the newest installer on
// GitHub Releases (the same place the app updates from); if GitHub can't be
// asked, it stays on the latest-release page, which works just as well.

export const REPO = "https://github.com/alexmercer500/Desk-comp";
const RELEASES = "alexmercer500/Desk-comp-releases";

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string; size: number }[];
}

export async function links() {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-link="repo"]')) a.href = REPO;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-link="changelog"]')) a.href = `${REPO}/blob/main/CHANGELOG.md`;

  let release: Release;
  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASES}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    release = (await res.json()) as Release;
  } catch {
    return;
  }
  const installer = release.assets.find((a) => /x64-setup\.exe$/i.test(a.name));
  if (!installer) return;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-link="download"]')) {
    a.href = installer.browser_download_url;
  }
  const version = release.tag_name.replace(/^v/, "");
  const mb = Math.max(1, Math.round(installer.size / 1e6));
  for (const p of document.querySelectorAll<HTMLElement>("[data-version]")) {
    p.textContent = `Version ${version} · ${mb} MB · Windows 10 and 11 · free · MIT licence`;
  }
}
