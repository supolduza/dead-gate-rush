# Dead Gate Rush 3D

A portrait, mobile-first 3D zombie gate-runner shooter. Vanilla JS ES modules + Three.js r186 (vendored in `vendor/three.min.js`, MIT, no CDN), no build step.

NOTE: ES modules need http(s) - use a local server, opening index.html from file:// will not work.

## Run locally
```
cd lastz-game
python3 -m http.server 8000   # then open http://localhost:8000
```
Add `?debug` to the URL to expose test hooks on `window.__dgr`.

## Controls
Drag (mouse/touch) or ←/→ / A/D to steer. P or Esc pauses.

## Deploy to GitHub Pages
1. Create a public repo (e.g. `dead-gate-rush`) and push the contents of this folder to the `main` branch:
   ```
   git init && git add . && git commit -m "Dead Gate Rush"
   git branch -M main
   git remote add origin https://github.com/<you>/dead-gate-rush.git
   git push -u origin main
   ```
2. Repo → Settings → Pages → Source: "Deploy from a branch", Branch `main` / `(root)` → Save.
3. After ~1 min it's live at `https://<you>.github.io/dead-gate-rush/`.

## Submit to CrazyGames
1. Create a developer account at https://developer.crazygames.com and click "Submit game".
2. Choose HTML5, upload a zip of this folder (index.html at the zip root), orientation: portrait, mobile + desktop.
3. Use the Preview/QA tool to check the SDK: the game calls `loadingStart/Stop`, `gameplayStart/Stop`,
   `midgame` ads (on restart and between levels from level 3) and `rewarded` ads (Revive, Double Coins).
4. Provide cover art (logo in `assets/logo.png`, screenshots in `shots/`), a description and tags (zombie, shooter, runner, math).

The SDK script (`https://sdk.crazygames.com/crazygames-sdk-v3.js`) is loaded in index.html and every call is guarded:
the SDK is only used when `SDK.environment === 'crazygames'`. Elsewhere (GitHub Pages, localhost) midgame ads are skipped
and rewarded buttons grant the reward directly. Every ad call has a timeout (6 s if no ad starts, 90 s hard cap) so the game can never stall. Remove the fallback in `CG.ad()` in game.js
if you want rewards to require an ad everywhere.

## Files
- `index.html`, `style.css`, `game.js` – the game
- `assets/` – logo + weapon icons; all 3D models (heroine, soldiers, 3 zombie types, boss, barrels, gates, bridge) are built in code
- `vendor/` – Three.js bundle + license
- Progress (coins, upgrades, level, mute) is saved in localStorage key `dgr_save_v1`.
