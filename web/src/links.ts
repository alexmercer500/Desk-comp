// Where the buttons go. The downloads point at the newest installer and the
// newest Android app on GitHub Releases (the same place both apps update
// from); if GitHub can't be asked, they stay on the releases pages, which work
// just as well.

const RELEASES = "alexmercer500/Desk-comp-releases";

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string; size: number }[];
}

export async function links() {
  void android();

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

/** The newest Android app: a release only carries one when the phone app changed, so look back through a few. */
async function android() {
  let releases: Release[];
  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASES}/releases?per_page=20`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    releases = (await res.json()) as Release[];
  } catch {
    return;
  }
  for (const r of releases) {
    const apk = r.assets.find((a) => /Android-([\d.]+)\.apk$/i.test(a.name));
    if (!apk) continue;
    for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-link="android"]')) a.href = apk.browser_download_url;
    const version = /Android-([\d.]+)\.apk$/i.exec(apk.name)?.[1];
    const mb = Math.max(1, Math.round(apk.size / 1e6));
    for (const p of document.querySelectorAll<HTMLElement>("[data-android-version]")) {
      const how = p.querySelector("a");
      p.textContent = `Version ${version} · ${mb} MB · free · Android 11 or newer · `;
      if (how) p.append(how);
    }
    return;
  }
}
