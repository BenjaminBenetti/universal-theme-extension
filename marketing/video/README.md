# Marketing video

A one-minute video of Universal Theme: Inky's splash, how picking a theme works, one page in all
75 themes (faster and faster), a few other sites, and Inky's end card. It is rendered from real
captures of the extension, so re-run both steps after the themes or the extension change.

1. **Capture** the extension on the pages the video shows, with the real Jev
   (`JEV_KEY` in `secrets.env`):

   ```sh
   HERO_URL=https://… HERO_USER=… HERO_PASS=… npm run video:capture
   ```

   `HERO_URL` is the page the video is built around. `HERO_USER` and `HERO_PASS` sign in to it
   and are only read from the environment. Captures land in `out/capture`; the browser profile in
   `out/profile` keeps the session between runs.

2. **Render** the video (needs `ffmpeg`):

   ```sh
   npm run video:render                        # ../universal-theme.mp4 (checked in)
   npm run video:render -- --stills 3.3,42.3   # out/stills/*.png, single moments to check
   ```

`stage.ts` is the whole composition as a function of time (`renderFrame(t)`), plus the chiptune
soundtrack, synthesized on the same timeline. `render.ts` plays it frame by frame in headless
Chromium and pipes the frames into ffmpeg. The video itself is checked in at
`marketing/universal-theme.mp4`; everything under `out/` (captures, profile, stills) is git-ignored.

The theme cycle speeds up to 15 themes a second. Past three switches a second it only moves
between themes of the same brightness, so it never strobes between dark and light.
