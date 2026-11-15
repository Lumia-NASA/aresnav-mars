# MarsView — Interplanetary Survival Guide: Martian Map

> **NASA Space Apps Challenge 2026**
> **Team Lumia**
> Target region: **Jezero Crater delta (`lat: 18.4447, lng: 77.4508`, `elev: -2540.5 m`)**

---

## Overview
**MarsView** is a prototype for planning walks (EVAs) on Mars. It combines historical NASA and ESA mission data (terrain, imagery, the Perseverance traverse, minerals) with a simulated suit model. For a chosen route it answers whether the walk is GO, CAUTION or NO-GO, explains why, and says what to change. The data comes from public files and services with a local cache: **it is not a live feed**, and the verdict is a **planning simulation**, not a safety authorization.

---

## The three NASA science layers, unified
1. **Topography and altimetry (MGS MOLA + Mars Express HRSC):** 200 m terrain per point, with slope computed from it. It shows the general path and the steep slopes; it cannot see boulders or steps smaller than that.
2. **1 m HiRISE terrain (MRO HiRISE, USGS Astrogeology):** the terrain model used for the Perseverance landing. After a route is plotted, the app reads the 1 m terrain along it and measures the real slope every 5 m; short stretches above the limit are marked on the map. In the Helmet view, the ground around the walker uses this terrain. The backend reads only the 256 × 256 m blocks it needs (out of a 1.8 GB file) and caches them.
3. **Martian weather (Perseverance MEDA):** minimum and maximum temperature and pressure from the latest sol NASA published (`/api/v1/weather`), with the date and the age of the reading.
   - The public MEDA feed has no wind, dust or radiation. Those values come from the API contract and carry the **SAMPLE** label.
   - Today's sunrise and sunset are computed with the Mars24 algorithm and checked against MEDA's own times (less than 1 min apart).
4. **Mineralogy and the rover route (Mars 2020 + CRISM):** the real Perseverance traverse and orbital detections of hydrated minerals (CRISM), which show where water once was.

---

## The demo, start to finish
Science route → risk explained → comparison → real panorama of the place → decision → link cut. The full script, including the 29-second video version, is in [`docs/PITCH.md`](docs/PITCH.md).

1. **Science route:** pick the Three Forks sample depot, a real place where Perseverance left sample tubes, 3.8 km from base, carrying 18.5 kg. The 1 m HiRISE check finds two short stretches above the slope limit and walks around them (+59 m); the numbers below include those detours (run `npm run prewarm` so the 1 m tiles are cached).
2. **Risk explained:** the verdict reads `NO-GO · not enough O₂` with the reason "return O₂ 20% < 30%". The **Why?** button shows that the walk out (1 h 57) is slower than the walk back (1 h 42) because the path climbs, plus the terrain calibration.
3. **One-click decision:** clicking the verdict jumps to the stretch past the **turn-back point**. The **What to do** box offers: turn back there, carry at most 13.0 kg, or take the safe route.
4. **Comparison:** the dangerous short route is dashed red and the safe detour green. The map also shows the 15 and 30 min walking reach and what can be reached with the current payload.
5. **Real panorama:** a 360° Mastcam-Z panorama of the place. Synthetic views are shown in purple and labeled "not a photo".
6. **ARES copilot:** answers by voice ("Where do I turn back?") using only the app's numbers. It works with Claude or in local mode.
7. **Follow live:** the **Follow live** button follows the EVA live (simulated) in the Helmet view.
   - **Panel:** plan vs. actual (time and O₂), countdown to the turn-back point (by O₂ or by daylight, whichever comes first), next stop, radio and distance off the route.
   - **ARES:** speaks on its own at the key moments. With the actual pace at 85%, it reports the delay, "turn back in 5 min" and "turn back now".
8. **Link cut:** the **NASA link · live** button simulates the Earth–Mars link going down. Route, verdict and physics keep working. Layers that need the internet say "unavailable offline".

In the Helmet's 3D terrain you can move **on foot** (suited astronaut, eyes at 1.7 m), in a **crewed rover** (eyes at 2.4 m, 10 km/h, stops on climbs above 20°) or in **free flight**.

---

## Limits (we say this in the presentation)
- **200 m terrain:** it chooses the general path but hides boulders and steps. The 1 m HiRISE terrain then checks the route corridor:
  - the panel says how much of the route it checked: **verified** (98% or more), **partial** (with the share, and gray dashes on the map where the route relies only on the 200 m grid) or **not verified**. It never says "confirmed" for a part it did not see;
  - where a short stretch goes above the slope limit, the app searches a **1 m detour** on a 5 m grid around it and applies it to the route, the ▶ simulation, the live walk and the GeoJSON export. If no detour fits, the stretch stays flagged;
  - it only exists inside the mosaic area (about 37 × 39 km around the landing site), and rocks smaller than about 2 m remain invisible.
- **Cold 1 m download:** a tile not yet cached comes from the USGS file row by row. Neighbor tiles in the same row share those reads, each tile has a 30 s deadline, and the panel shows how many tiles came from cache. After 25 s the analysis uses what arrived (and says it is partial), then runs again when the rest is in. Run `npm run prewarm` before the demo.
- **Calibration:** the terrain sits on average 19 m above the elevation Perseverance measured at 613 stops (σ 19 m). The app shows this under "Why?".
- **Simulated physics:** oxygen use, heart rate and pace vs. payload come from a model, not from a real suit. The assumptions and how much each one weighs are in [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md).
- **Weather in two sets:** temperature and pressure are real MEDA measurements, but dated (latest public sol: April 2024). Wind, radiation and dust are sample values, labeled SAMPLE. None of these values feed the verdict; only the age of the reading shows up as a caveat in the checklist.
- **Route:** the search runs on a 200 m grid inside the mission area. "No safe route found" holds for that model; it does not prove that no path exists.
- **Hypothetical base:** Ares-1 does not exist.
- **Not yet tested:** a real phone, and the copilot with a live API key. Performance numbers are in [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).

---

## Defense and resilience architecture
* **Offline-first cache:** route data (terrain, traverse, telemetry) is cached locally in `/backend/data/cache/` and keeps working without internet. FU Berlin layers, global maps and 360° panoramas only work offline if they are already cached. Internet or NASA API hiccups do not take the app down.
* **ScopeGuard (KhaosForge):** strict SSRF blocking that only allows connections to NASA domains (`mars.nasa.gov`, `trek.nasa.gov`, `api.nasa.gov`), the FU Berlin Jezero WebGIS (`maps.planet.fu-berlin.de`) and the USGS Astrogeology data bucket for the HiRISE terrain.
* **EvidenceGate:** the backend computes the SHA-256 of each response and sends it along. This lets you check that the data did not change **between the backend and the screen** (it also goes into the exported GeoJSON). It is not end-to-end integrity and **does not authenticate the source**: the hop between NASA and our backend is not covered, and the hash is computed by our own server, not signed by NASA.
* **Restricted CORS and rate limiting:** protects the Fastify backend against abuse and denial of service.

---

## Repository layout
```
aresnav-mars/
├── CONTRATO_API.json         # Unified frontend <-> backend integration contract
├── .gitignore                # Strict isolation of secrets and private skills
├── backend/                  # Fastify 5 backend (allowlisted proxy, cache, rate limit, CSP)
│   ├── server.js             # Routes: /health, telemetry, traverse, waypoints, tiles, dem, crism and navcam
│   ├── package.json          # Backend dependencies
│   ├── Dockerfile            # Container hardening (Alpine, non-root, dumb-init)
│   ├── .env.example          # Environment variables
│   └── data/cache/           # Resilient local telemetry cache
├── frontend/                 # Mars tactical HUD (Leaflet 2D / CesiumJS 3D)
├── tests/
│   ├── smoke-test.js         # Contract, ScopeGuard and EvidenceGate
│   ├── physics-test.js       # Suit physics, Tobler, turn-back point, radio, verdict and decision
│   ├── sun-test.js           # Sun and time on Mars against MEDA and the Perseverance landing
│   ├── exec-test.js          # Walk execution engine: position, O₂, turn-back by O₂ and daylight, callouts
│   ├── calc-test.js          # ARES exact calculator: math, unit conversions, weight on Mars
│   ├── copilot-test.js       # ARES switches AI provider when one fails (fake local servers, no real key)
│   ├── terrain-1m-test.js    # 1 m terrain: partial coverage, detour, grouped USGS reads with a deadline
│   ├── hirise-test.js        # 1 m HiRISE terrain: tile math, decoding and the route corridor
│   ├── fub-test.js           # FU Berlin layers, 360° viewer and offline mode (starts the backend on a test port)
│   └── demo-flow-test.js     # The full presentation run in a headless Chrome
├── tools/build-fub-cache.py  # Downloads and converts the FU Berlin layers
├── tools/prewarm-demo.js     # Pre-loads and checks offline everything the demo uses
└── docs/
    ├── PITCH.md              # The 29-second video script and the live demo script
    ├── SUBMISSION.md         # Space Apps submission kit: rules, checklist and form texts
    ├── PERFORMANCE.md        # Loading, 360° and memory measurements
    └── ASSUMPTIONS.md        # Model assumptions and verdict sensitivity
```

---

## Running the validation tests
```bash
npm ci --prefix backend
node tests/smoke-test.js
node tests/physics-test.js
node tests/sun-test.js
node tests/exec-test.js
node tests/calc-test.js
node tests/copilot-test.js
node tests/hirise-test.js
node tests/terrain-1m-test.js
node tests/fub-test.js
node tests/demo-flow-test.js   # the full demo run in a headless Chrome
```
Or all at once: `cd backend && npm test`, which runs the ten in sequence. The demo run also injects a synthetic 1 m terrain with a steep mound on the route and checks that the detour is applied and that ▶ walks along it (no USGS download needed).

The smoke test also fails if git tracks any `.env` file (other than `.env.example`) or any file containing an API key. AI keys go only in `backend/.env`, which git ignores.

The demo run tests the 360° panorama in two scenarios: one that accepts a network failure as long as the viewer explains what happened, and one with the panorama already cached, which requires the complete image.

**Before the presentation** (with the backend running and internet):
```bash
cd backend && npm run prewarm         # caches everything the demo uses (~45 s)
npm run check-offline                 # checks, without internet, that every item opens from the cache
```
