# Dead Gate Rush

A portrait, mobile-first HTML5 zombie gate-runner shooter. Vanilla JS + Canvas, no build step.

## Run locally
```
cd lastz-game
python3 -m http.server 8000   # then open http://localhost:8000
```
(Opening index.html directly also works, but a local server is closer to real hosting.)

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
if the SDK is missing or fails (e.g. on GitHub Pages / offline), the game runs normally, midgame ads are skipped
and rewarded buttons grant the reward directly (so they work for testing). Remove the fallback in `CG.ad()` in game.js
if you want rewards to require an ad everywhere.

## Files
- `index.html`, `style.css`, `game.js` – the game
- `assets/` – generated sprites (transparent PNG) + road tile; code-drawn fallbacks if any fail to load
- Progress (coins, upgrades, level, mute) is saved in localStorage key `dgr_save_v1`.
