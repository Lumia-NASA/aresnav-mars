# MarsView: NASA Space Apps 2026 submission kit

Everything the Project page needs, ready to copy. Rules come from the official [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/) and [Judging & Awards Guide](https://www.spaceappschallenge.org/resources/judging-awards-guide), both dated November 13, 2026.

**Challenge:** [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/)

## Deadline

**Click "Submit for Judging" before Sunday, November 15, 11:59 p.m.** in the time zone of the team's Local Event. After that, no edits or exceptions are allowed. You can save and resubmit as many times as you like before the deadline, and only the last submission counts.

Where to submit: profile icon (top right) → **My Team** → **Project** tab → **Edit**. Turn the edit **Lock** on so two people don't overwrite each other, and click **Save Progress** often.

## Checklist (all required)

- [ ] All team members are confirmed (not waitlisted) at the **same Local Event** and appear on the Members tab (maximum 6).
- [ ] Every field below is filled in, **in English**.
- [ ] **Demo:** a video of **30 seconds or less** with English subtitles if anyone speaks another language, **or** at most **7 slides**, including the title slide. Projects over these limits can't go to Global Judging.
- [ ] The demo and the final project are on a **public link**: no login, no password, no permission request. Test both links in a private browser window.
- [ ] Images may be JPG, PNG or GIF up to 10 MB. Videos and documents can't be uploaded; they have to be links.
- [ ] Nothing shows a person under 18 years old.
- [ ] AI-generated material is marked (see "Use of Super Intelligence" below).
- [ ] Nothing related to China (NASA's China funding restriction). Already checked: the Zhurong rover radar and landing site were removed from the app.
- [ ] Tick **Terms and Conditions** and **Confirm All Work is Original**, then click **Submit for Judging** and wait for the confirmation banner.
- [ ] Afterwards, download the participant certificate from your Profile.

## ⚠️ Blockers to solve before submitting

1. **The GitHub repository is private.** Judges can't open it, but "Link to Final Project" must be public. Options:
   - **A. Recommended: publish a clean public copy.** Create a new public repository with the current code and no git history, without `backend/team.env`. The team key stays private.
   - **B. Make this repository public.** First revoke the NVIDIA key at build.nvidia.com, because it is in the git history (`backend/team.env`).
   - **C. Also link a live site.** Judges can try a hosted app without installing anything. In that case the hosting server needs its own key in its environment.
2. **Mark AI-generated material.** The rules require a visible watermark on SI-generated images and videos, and a written mention for SI-generated code and data. The MarsView logo files in `frontend/assets/` were redrawn with SI help: either add a small "SI-assisted" mark to them on the slides, or use the team's original logo. If the landing page or the video uses AI-generated images, they need a watermark too.
3. **No NASA branding in generated content.** Don't use the NASA logo ("meatball" or "worm") on slides or in the video. The app has none.

## Judging (1 to 5 in each)

| Criterion | What judges look for | Where MarsView scores |
|---|---|---|
| Impact | A real problem; benefits many people | Astronaut safety on EVAs, the challenge's first priority: GO / NO-GO with reasons and fixes |
| Creativity | A new idea or a meaningful improvement | A turn-back point from the O₂ budget, "what to change" suggestions, a live walk with callouts, and a helmet HUD |
| Validity | Scientifically sound, feasible, usable | Real terrain checked against 613 Perseverance stops; Mars24 sun times; tests; documented assumptions; works offline |
| Relevance | Answers the challenge; NASA data is core | Layers of optical, topographic, spectral (CRISM), thermal (THEMIS), atmospheric (MEDA) and rover point-of-view data on a real route |
| Presentation | Clear story, good visuals (demo and page) | 29-second script in `docs/PITCH.md`; 7-slide outline below |

---

## Form fields (copy and paste)

### Project Name
MarsView

### High-Level Project Summary
MarsView is a walk planner and helmet HUD for the first astronauts on Mars. It layers real NASA and ESA data over a hyperlocal route in Jezero crater: HiRISE, CTX and HRSC imagery, 1 m HiRISE and 200 m MOLA/HRSC terrain, Perseverance's traverse, CRISM hydrated minerals, THEMIS infrared and MEDA weather. For any destination it plots a safe walking route and gives a GO / CAUTION / NO-GO verdict that accounts for slope, suit payload, oxygen, radio line of sight and daylight. It explains why, and says exactly what to change: carry less, turn back at a given point, or take the safe route. It then follows the walk live and calls out the turn-back point. NASA's first priority is crew safety, and MarsView turns scattered mission data into decisions an astronaut can act on.

### Link to Project Demo
Paste the public link to the 30-second video (YouTube or Google Drive, set to "anyone with the link") or to the slides. Script: `docs/PITCH.md`.

### Link to Final Project
**Use the live site:** https://marsview.vercel.app, once it is deployed. On Nov 15 it still returned 404 DEPLOYMENT_NOT_FOUND. The site has to open with no login, and the MarsView dashboard behind it has to work for a judge: it needs the backend running and reachable (see "Hosting" below). Put the public code repository in the Detailed Project Description, so judges can also see the code.

### Hosting the live demo
- Vercel serves the static pages: the landing page and the `frontend/` folder.
- The MarsView backend (Fastify) has to run on a server that keeps running, for example Render, Railway or Fly.io. The repository already has a `Dockerfile`. On that server, set `NVIDIA_API_KEY` as an environment variable, and set `ALLOWED_ORIGIN=https://marsview.vercel.app`.
- Point the frontend to it: in `frontend/config.js`, set `window.ARESNAV_API` to the backend address.
- Without the backend the dashboard still opens in offline mode (route, verdict and physics from local data), but the imagery, panoramas and ARES AI need the backend.

### Detailed Project Description
**What it does.** MarsView helps an astronaut plan and carry out a Marswalk in Jezero crater, Perseverance's landing site. Pick a destination, for example the Three Forks sample depot 3.8 km from a hypothetical Ares-1 base, and MarsView:
- plots the safest walking route over real terrain, avoiding slopes above the suit's limit for the payload carried;
- shows distance, walking time out and back (they differ because the route climbs), total duration, climb, maximum slope, an elevation profile and a step-by-step itinerary;
- gives a three-level verdict (GO / CAUTION / NO-GO) with the reasons in numbers;
- turns each problem into a fix: the exact turn-back point that still returns with a 30% O₂ reserve, the maximum payload that makes the walk feasible, and the safe detour when the direct path is too steep;
- checks radio line of sight from the habitat over the real terrain, including Mars' curvature, and flags stretches that need the MRO relay;
- checks daylight against the real sunset at Jezero (Mars24 algorithm, verified against MEDA);
- checks the route corridor with the 1 m HiRISE terrain every 5 m, after planning on the 200 m grid;
- follows the walk live in a helmet HUD: plan vs. actual, O₂, countdown to the turn-back point, and spoken callouts ("turn back in 5 minutes", "turn back now");
- shows what the place looks like from the ground, using Perseverance Navcam panoramas and Mastcam-Z 360° views;
- includes ARES, a voice copilot that answers questions using only the app's numbers, plus an exact calculator for math and unit conversions;
- keeps working when the Earth–Mars link drops, with the route, verdict and physics running from a local cache.

**How it works.** A Fastify (Node.js) backend fetches NASA data through an allowlist, caches it for offline use and seals each response with SHA-256. The frontend uses CesiumJS for the 3D globe and the first-person terrain, and Leaflet for the 2D map. Route search is A* on the terrain grid. The physics model uses Tobler's hiking function, with suit mass, a payload-dependent slope limit and payload-dependent O₂ consumption. All assumptions are documented and their sensitivity is tested.

**Honest limits.** The suit physics is a planning model, not a validated EVA standard. The 200 m terrain hides boulders. Wind and radiation are sample values, because the public MEDA feed doesn't include them. The base is hypothetical. Every number in the app is labeled MEASURED, DEM-DERIVED or SIMULATED.

**Tools.** JavaScript, Node.js, Fastify 5, CesiumJS, Leaflet, Python (data preparation), automated tests (unit tests plus a full demo run in headless Chrome) and GitHub Actions CI.

### NASA Data
The form asks for **Link text + URL** for each resource. Every URL below was checked on Nov 15, 2026.

| Link text | URL |
|---|---|
| NASA Mars Trek (JPL): imagery, terrain and layers | https://trek.nasa.gov/mars/ |
| Mars Reconnaissance Orbiter (HiRISE, CTX, CRISM) | https://science.nasa.gov/mission/mars-reconnaissance-orbiter/ |
| HiRISE images and DTMs | https://www.uahirise.org/ |
| CTX camera (MRO) | https://www.msss.com/all_projects/mro-ctx.php |
| CRISM hydrated minerals (PDS) | https://pds-geosciences.wustl.edu/missions/mro/crism.htm |
| Mars Global Surveyor (MOLA, TES) | https://science.nasa.gov/mission/mars-global-surveyor/ |
| MOLA elevation data (PDS) | https://pds-geosciences.wustl.edu/missions/mgs/mola.html |
| Mars Odyssey | https://science.nasa.gov/mission/odyssey/ |
| THEMIS infrared (Mars Odyssey) | https://themis.asu.edu/ |
| Viking Orbiter color mosaic | https://science.nasa.gov/mission/viking-1/ |
| Mars 2020 Perseverance mission | https://science.nasa.gov/mission/mars-2020-perseverance/ |
| Perseverance raw images (Navcam) | https://mars.nasa.gov/mars2020/multimedia/raw-images/ |
| Perseverance MEDA weather | https://mars.nasa.gov/mars2020/weather/ |
| Perseverance location and traverse map | https://mars.nasa.gov/maps/location/ |
| Mars24 sunclock algorithm (NASA GISS) | https://www.giss.nasa.gov/tools/mars24/ |
| USGS Astrogeology: HiRISE DTM of Jezero | https://astrogeology.usgs.gov/ |

In short:
- MRO HiRISE: 25 cm orthomosaic of Jezero, and the controlled 1 m HiRISE DTM of the Mars 2020 landing site (USGS Astrogeology)
- MRO CTX: 6 m orthomosaic of Jezero
- MRO CRISM: hydrated mineral detections
- MGS MOLA: global elevation, colored relief and roughness; blended with Mars Express HRSC at 200 m
- Mars Odyssey THEMIS: daytime infrared
- MGS TES: dust cover and thermal inertia
- Viking Orbiter: global color mosaic
- Mars 2020 Perseverance: traverse path, official waypoints (used to calibrate the terrain at 613 stops), Navcam raw images (rover point-of-view panoramas) and MEDA weather (temperature and pressure)
- NASA Mars Trek (JPL): WMTS, ImageServer and FeatureServer services for all of the above
- Human exploration zones from NASA's 2015 landing site workshop (Mars Trek EZMars)
- NASA GISS Mars24 algorithm: Mars local time, sunrise and sunset

### Space Agency Partner Data and Other References
| Link text | URL |
|---|---|
| ESA Mars Express (HRSC camera) | https://www.esa.int/Science_Exploration/Space_Science/Mars_Express |
| HRSC data (PDS) | https://pds-geosciences.wustl.edu/missions/mars_express/hrsc.htm |
| FU Berlin Jezero WebGIS (mosaic, channels, Mastcam-Z panoramas) | https://maps.planet.fu-berlin.de/jezero/ |
| CesiumJS (3D globe) | https://cesium.com/platform/cesiumjs/ |
| Leaflet (2D map) | https://leafletjs.com/ |
| Fastify (backend) | https://fastify.dev/ |
| NVIDIA API catalog: Nemotron 3.5 Bolt (ARES copilot) | https://build.nvidia.com/ |
| Manrope font | https://fonts.google.com/specimen/Manrope |
| JetBrains Mono font | https://www.jetbrains.com/lp/mono/ |
| MarsView source code (public copy) | add the public repository URL once it is created |

In short:
- **ESA:** Mars Express HRSC (ESA/DLR/FU Berlin, CC BY-SA 3.0 IGO), used for terrain and color.
- **Freie Universität Berlin, Jezero WebGIS:**
  - natural-color HiRISE + CTX + HRSC mosaic;
  - lake shoreline, channels and landing ellipse;
  - Mastcam-Z 360° panoramas.
- **USGS Astrogeology:** HiRISE DTM of Jezero (Fergason et al., 2020).
- **Open-source libraries:**
  - CesiumJS (Apache 2.0);
  - Leaflet (BSD-2);
  - Fastify and axios (MIT); dotenv (BSD-2);
  - Manrope and JetBrains Mono fonts (SIL OFL).
- **Methods:**
  - Tobler's hiking function;
  - Mars24 (Allison & McEwen 2000);
  - Douglas-Peucker line simplification.
- **AI used inside the app:** NVIDIA Nemotron 3.5 Bolt through the NVIDIA API catalog. Anthropic Claude is supported as an alternative.

### Use of Super Intelligence (SI)
Yes.
- **Coding assistant.** We used Claude Code (Anthropic) to write, refactor and test parts of the code, to translate the documentation into English and to review the interface. The team chose the challenge, the idea, the location, the safety logic and every design decision. AI-assisted commits are marked "Co-Authored-By: Claude" in the git history.
- **ARES copilot.** The in-app copilot uses a large language model (NVIDIA Nemotron 3.5 Bolt). It answers only from the app's computed numbers. Its arithmetic comes from a deterministic calculator in our backend, not from the model. When no AI is available it falls back to local rules.
- **Logo.** The MarsView logo was redrawn with SI assistance and is marked as such.
- **No SI-generated photos of Mars.** All Mars imagery in the app is real mission data from NASA, ESA and FU Berlin.

---

## Demo option B: 7 slides (title and intro count)

1. **Title:** MarsView. *Every step planned. Every breath counted.* Team Lumia, team member names, and the challenge "Interplanetary Survival Guide: Martian Map".
2. **The problem:** before every Marswalk, an astronaut needs to know three things: can I get there, can I get back, and will anyone hear me? The data exists, but it's scattered across missions and websites.
3. **The solution:** a screenshot of the planner with the route to Three Forks. One screen layers the real data and gives a GO / CAUTION / NO-GO verdict.
4. **It explains and it acts:** NO-GO, return O₂ 20% < 30%. Turn back at 3.13 km, or carry 13.0 kg instead of 18.5. Show the "Why?" card.
5. **On the ground:** the helmet HUD with the live walk and the turn-back callout, plus a real Navcam / Mastcam-Z view of the place.
6. **The data behind it:** logos of the missions and instruments as text, not NASA logos (HiRISE, CTX, CRISM, MOLA, HRSC, THEMIS, MEDA, Perseverance). Validation: the terrain was checked against 613 Perseverance stops. It works offline.
7. **The future:** any Mars site, a tablet or a visor, real suit telemetry, and crews planning safer and bolder science.

Keep the text short and the screenshots big.
