// Brings your own character's pictures (custom.rs) into this window, and again
// whenever they change. Kept apart from custom.ts, which draws without Tauri
// (the playground and the tests).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MOODS, setCustomPictures, type Mood } from "./custom";

async function decode(src: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** Loads the pictures now; true when there's a main one (a character to show). */
export async function loadCustomCharacter(): Promise<boolean> {
  const urls = await invoke<Record<string, string>>("custom_pictures").catch(() => ({}) as Record<string, string>);
  const next: Partial<Record<Mood, HTMLImageElement>> = {};
  await Promise.all(
    MOODS.map(async (mood) => {
      const url = urls[mood];
      const img = url ? await decode(url) : null;
      if (img) next[mood] = img;
    }),
  );
  setCustomPictures(next);
  return next.idle !== undefined;
}

/** Loads them again after every change (Settings); `changed` hears whether there's a main picture. */
export function followCustomCharacter(changed: (hasMain: boolean) => void): void {
  void listen("custom-character", () => void loadCustomCharacter().then(changed));
}
