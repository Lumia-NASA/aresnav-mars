# AresNav — pitch and live demo (about 4 minutes)

> Team Lumia · NASA Space Apps 2026 · Challenge: an integrated, layered view of a place on Mars to help a human explorer plan and carry out a walk.

## The one-line pitch
**AresNav turns NASA and ESA orbital data into a go / no-go decision for a walk on Mars — and tells the astronaut exactly what to change when the answer is no.**

## The problem (20 s)
An astronaut leaving a habitat in Jezero crater needs to answer three questions before every walk: *Can I get there? Can I get back? Will anyone hear me if something goes wrong?* The data exists (terrain from MOLA and HRSC, HiRISE imagery, the Perseverance traverse, MEDA weather), but it lives in different missions, formats and websites.

## The demo, step by step

| # | What you do on screen | What you say | Data behind it |
|---|---|---|---|
| 1 | Open the app on the globe, fly to Jezero. The ground turns to natural color as you zoom in. | "Everything you see is real: NASA terrain and imagery, ESA's HRSC camera, FU Berlin's color mosaic of Jezero." | MOLA, HRSC, HiRISE, CTX via NASA Mars Trek; FU Berlin WebGIS |
| 2 | Pick **Three Forks sample depot** — the real place where Perseverance left sample tubes. | "Our astronaut wants to visit the sample depot, 3.7 km away, carrying 18.5 kg of equipment." | Perseverance traverse and waypoints (MMGIS) |
| 3 | The verdict reads **NO-GO · METABOLIC — return O₂ 21% < 30%**. Click **Why?** | "The route is flat enough. The problem is oxygen: the walk out is 1 h 54 because it climbs, the walk back is 1 h 40. With 18.5 kg the suit burns oxygen faster." | Tobler walking model + suit mass; asymmetric out/back times |
| 4 | Click the verdict. The map flies to the stretch past the **turn-back point** and marks it in red. | "AresNav doesn't just say no. It shows where the plan breaks: past 3.07 km she can't get home with a 30% reserve." | Turn-back point from the oxygen budget, stops included |
| 5 | Click **Carry 13.5 kg instead of 18.5**. Verdict becomes **CAUTION**. | "Drop five kilos and the walk is feasible. The remaining caution is radio." | Max payload solved from the same model |
| 6 | Click **Show segments without radio**. | "From the habitat's 2 m antenna, the terrain hides her for most of the route, so comms relay through the Mars Reconnaissance Orbiter." | Line of sight over the real terrain, with Mars curvature |
| 7 | Switch to **Shortest** route on a far point: the direct path is dashed red, the safe detour green. | "When the short way is too steep for the load, it offers the safe detour in one click." | Slope from the 200 m terrain model |
| 8 | Click a **360°** point near the depot. | "Before going, she can stand there: this is a real Mastcam-Z panorama from Perseverance. Purple points are synthetic views rendered from the terrain — we label them so nobody mistakes them for photos." | Mastcam-Z panoramas stitched by FU Berlin |
| 9 | Open **ARES · AI** and ask "Where do I turn back?" | "ARES answers by voice, using only the numbers the app computed. With no AI key or no network it still answers, in local mode." | Claude (Anthropic) through our backend, or local rules |
| 10 | Click **UPLINK: NASA LIVE** to cut the Earth–Mars link. | "Mars is up to 22 light-minutes away. When the link drops, route, verdict and physics keep working from the habitat's cache. Layers that need the internet say so." | Offline-first cache in the backend |

## What makes it different (20 s)
- **It explains itself.** Every verdict has its reasons, with numbers.
- **It acts.** Each reason comes with a fix: turn back here, carry less, take the safe route.
- **It is honest about data.** Every number is marked MEASURED, DEM-DERIVED or SIMULATED. Every layer shows its source and license. Synthetic panoramas are labeled as such.
- **It works when the link is down.**

## Limits we say out loud
- **Terrain:** the route uses a 200 m terrain model. It finds the general path but hides boulders and small steps; check the HiRISE image along flagged stretches.
- **Calibration:** the terrain model sits on average 19 m above the elevations Perseverance measured at 613 of its stops (σ 19 m). We show this calibration inside the app.
- **Simulated values:** suit physics (oxygen use, heart rate, pace vs. payload) is a model, not data from a real suit. The weather values come from the AresNav contract (sample MEDA values).
- **Hypothetical base:** the Ares-1 habitat does not exist.
- **Not yet tested:** a real phone, and the AI answering with a live API key during the demo.

## Credits
NASA/JPL-Caltech, NASA Mars Trek, MSSS, University of Arizona (HiRISE), ASU (THEMIS, Mastcam-Z), ESA/DLR/FU Berlin (HRSC, CC BY-SA 3.0 IGO), Freie Universität Berlin Planetary Sciences (Jezero WebGIS, panoramas), USGS. Full table in the app under **Data**.
