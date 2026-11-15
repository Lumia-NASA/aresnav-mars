# MarsView pitch video

The 29-second demo video for NASA Space Apps 2026, built with [Remotion](https://www.remotion.dev/) (React). The app footage is recorded from the real MarsView app, so nothing on screen is mocked.

**Rules this video follows** (Space Apps Project Submission Guide):
- 29 s, under the 30 s limit. The timeline is in `src/theme.ts` (`SCENES`, `TOTAL_FRAMES`).
- All on-screen text is English.
- A visible **SI-ASSISTED** mark stays on screen the whole time, because the animation was built with AI help.
- No NASA logos. Data sources are named as text.
- No people on screen, so no minors.
- Order of the official script: who we are (0-2 s), the challenge (2-5 s), name and tagline (5-10 s), how it works (10-20 s), the future (20-29 s).

## Run it

```bash
cd pitch
npm install
npm run dev -- --port=3100      # Remotion Studio at http://localhost:3100 (port 3000 is the MarsView backend)
```

Render the MP4 (needs internet the first time, for the Google Fonts and the Chrome Headless Shell):

```bash
npx remotion render src/index.ts MarsViewPitch out/marsview-pitch.mp4 --codec=h264 --crf=18
```

`out/` is ignored by git, so the MP4 never goes into the repository.

## Record the app footage again

Run from the repository root (needs `npm ci --prefix backend` and Chrome or Edge):

```bash
node pitch/scripts/capture.mjs                   # app screens: planner, Why?, CAUTION, 360 panorama, helmet
FLY_ONLY=1 node pitch/scripts/capture.mjs        # the clean globe fly-over used behind the title
```

The script starts its own backend on port 3200 with no AI key, drives the app in a headless Chrome and saves JPEGs to `pitch/public/footage/`.

## Change things

- **Names of the presenters:** set `PRESENTERS` in `src/theme.ts` (the guide asks for name and team in the first seconds).
- **Captions and chips of each app screen:** the `SHOTS` list in `src/scenes.tsx`.
- **Colors and fonts:** `src/theme.ts` (same palette as the landing page and the app).
- **Check the length** before uploading: `TOTAL_FRAMES / FPS` must stay at 30 s or less.

## Upload

Upload the MP4 to YouTube as **Unlisted** (or Public), never Private. Open the link in a private window to check it plays without login. Paste it in the **Project Demo** field of the Space Apps project page. If the video has a voice-over made with AI, say so in the description.

## Remotion license

Remotion is free for individuals, non-profits and companies of up to 3 people. See https://www.remotion.dev/docs/license/pricing if the team has 4 or more people.

The Remotion agent skills are not committed. To install them for Claude Code: `cd pitch && npx remotion skills add`.
