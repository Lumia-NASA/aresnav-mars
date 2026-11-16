# MarsView pitch video

The 29-second demo video for NASA Space Apps 2026, built with [Remotion](https://www.remotion.dev/) (React). The app footage is recorded from the real MarsView app, so nothing on screen is mocked.

**Rules this video follows** (Space Apps Project Submission Guide):
- 29 s, under the 30 s limit. The timeline is in `src/theme.ts` (`SCENES`, `TOTAL_FRAMES`).
- All on-screen text is English.
- A visible **SI-ASSISTED · AI VOICE** mark stays on screen the whole time, because the animation was built with AI help and the narration is an AI-generated voice.
- The narration is **not a human voice on purpose**: the guide forbids any image, video or audio likeness of people under 18. The voice is the free Microsoft Edge neural voice `en-US-AriaNeural`, generated with `edge-tts`.
- No NASA logos. Data sources are named as text.
- No people on screen, so no minors.
- It follows the 29-second script of `docs/PITCH.md`: the globe flies into Jezero with the three questions (0-6 s), Three Forks and the NO-GO (6-13 s), **Why?** and "carry 13.5 kg instead of 18.5" (13-20 s), the helmet with ARES calling "turn back now" (20-24.6 s), the logo (24.6-29 s).
- The app screens show the route **without the 1 m detours** (3.73 km, 21% O₂ on return, carry 13.5 kg), with the current interface. They are recorded with `NO_DETOUR=1`.

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
NO_DETOUR=1 node pitch/scripts/capture.mjs                  # app screens: planner NO-GO, Why?, CAUTION (route without the 1 m detours)
NO_DETOUR=1 HELMET3D=1 node pitch/scripts/capture.mjs       # the helmet in first person with "turn back now"
FLY_ONLY=1 node pitch/scripts/capture.mjs        # the clean globe fly-over used behind the title
```

The script starts its own backend on port 3200 with no AI key, drives the app in a headless Chrome and saves JPEGs to `pitch/public/footage/`.

## Narration (AI voice)

The lines and the second each one starts are in `src/voice-lines.json`. To change the text, the voice or the timing, edit that file and run (from the repository root, with `pip install edge-tts imageio-ffmpeg`):

```bash
python pitch/scripts/voice.py
```

It writes one MP3 per line to `pitch/public/voice/`, cuts the silence at the ends and prints whether every line ends before the next one starts. Other English voices: `en-US-JennyNeural`, `en-US-AvaNeural`, `en-US-AndrewNeural`, `en-US-ChristopherNeural`. Faster or slower: `"rate": "+22%"` (global) or a `rate` on one line.

## Change things

- **Names of the presenters:** set `PRESENTERS` in `src/theme.ts` (the guide asks for name and team in the first seconds).
- **Captions and chips of each app screen:** the `SHOTS` list in `src/scenes.tsx`.
- **Colors and fonts:** `src/theme.ts` (same palette as the landing page and the app).
- **Check the length** before uploading: `TOTAL_FRAMES / FPS` must stay at 30 s or less.

## Upload

Upload the MP4 to YouTube as **Unlisted** (or Public), never Private. Open the link in a private window to check it plays without login. Paste it in the **Project Demo** field of the Space Apps project page.

**The rules ask you to acknowledge AI-generated audio in the descriptive text and in the metadata.** Put this in the YouTube description:

> MarsView by Team Lumia, NASA Space Apps Challenge 2026 (challenge: Interplanetary Survival Guide: Martian Map). The voice-over is AI-generated (Microsoft Edge neural text-to-speech, voice "Aria"). The animation was built with AI assistance (Claude Code, Remotion). All app footage is recorded from the real MarsView app using NASA, ESA and USGS data. Code: <public repository link>

The rendered file also carries the same note in its metadata (the `comment` tag), added by the render step below.

Render with the metadata:

```bash
npx remotion render src/index.ts MarsViewPitch out/marsview-pitch-raw.mp4 --codec=h264 --crf=18 --audio-codec=aac --audio-bitrate=192k
npx remotion ffmpeg -y -i out/marsview-pitch-raw.mp4 -c copy -metadata title="MarsView - NASA Space Apps 2026 pitch" -metadata artist="Team Lumia" -metadata comment="Voice-over: AI-generated (Microsoft Edge neural TTS, Aria). Animation built with AI assistance (Claude Code, Remotion). App footage: real MarsView app with NASA, ESA and USGS data." out/marsview-pitch.mp4
```

## Remotion license

Remotion is free for individuals, non-profits and companies of up to 3 people. See https://www.remotion.dev/docs/license/pricing if the team has 4 or more people.

The Remotion agent skills are not committed. To install them for Claude Code: `cd pitch && npx remotion skills add`.
