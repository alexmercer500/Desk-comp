/// <reference types="vite/client" />
// The 3D prototype page (three.html). Normally the playground (main.ts); in
// development, `?stage=corner` or `?stage=island` (with `&who=dogesh`) mounts
// the desktop app's own stage instead, framed as the app frames it, for checking.

const stageCheck = import.meta.env.DEV && new URLSearchParams(location.search).has("stage");
if (stageCheck) await import("./stagecheck");
else await import("./main");

export {};
