# MarsView (frontend)

Mission control for astronaut walks in Jezero Crater, on Mars. Built for the Mars challenge of the NASA Space Apps Challenge 2026.

Pick a destination and the app plots the walking route from the base. It computes distance, time, oxygen and schedule, builds a GO / NO-GO checklist and suggests science stops. The walk can be simulated from start to finish with the ▶ button.

## Golden rule: everything goes through the backend

The browser **never calls NASA directly** (skill `01-frontend-hud-skill`). Imagery, terrain, traverse, minerals, photos and telemetry come from the MarsView backend, which relays NASA's data, validates it and caches it:

| What | Backend route |
|---|---|
| Unified telemetry (`CONTRATO_API.json`) | `/api/v1/telemetry` |
| Perseverance traverse | `/api/v1/traverse` |
| Mars Trek image tiles | `/api/v1/tiles/:layer/:z/:y/:x` |
| Jezero terrain (200 m) | `/api/v1/dem/jezero` |
| 1 m HiRISE terrain along the route | `/api/v1/dem/hirise/:tx/:ty` |
| Terrain anywhere on Mars | `/api/v1/dem/patch/:lat/:lon` |
| Hydrated minerals (CRISM) | `/api/v1/crism` |
| Navcam photos | `/api/v1/navcam/...` |

If the backend goes down or answers `degraded: true`, the app switches to **local redundancy** and shows `OFFLINE TELEMETRY (CACHED)`: it uses the last stored telemetry, the terrain and traverse in the `data/` folder and a small set of images in `data/tiles/`. Rover photos and high-resolution zoom only work with the backend.

## Language

The interface is **English only**, as the submission rules require. The code writes its texts in Portuguese and `i18n.js` translates everything that reaches the screen (texts, tooltips, labels, the copilot voice and canvas drawings). The language is fixed: there is no switch, and a language saved in the browser by an older version is ignored.

## Land anywhere on Mars

1. Click the little astronaut (bottom right corner) and then any point on the globe or the map. Or use the search and land there.
2. The app asks the backend for the real terrain of the place (`/api/v1/dem/patch/:lat/:lon`: 2° × 2° blocks, HRSC + MOLA, about 230 m per point) and puts the camera 1.7 m above the ground, at **real scale**.
3. In the Helmet view, 3D terrain mode, there are three ways to move:
   - **On foot:** a suited astronaut with eyes at 1.7 m, 2.9 km/h (Shift = 5.8 km/h), with a natural step and head bob.
   - **Rover:** a crewed rover with eyes at 2.4 m, 10 km/h (Shift = 15 km/h). It tilts with the ground and stops on climbs above 20°.
   - **Free flight:** `E` climbs, `Q` descends (or the mouse wheel, or the "Height" slider, from 1.7 m to 20 km); speed grows with height.
   - The visor footer shows latitude, longitude, ground elevation, your height and the local slope, all computed from NASA's terrain.

On the globe the terrain is also at real scale; the `1×` / `2.5×` button exaggerates height only for reading the view from above. On the ground the scale is always 1×. Because HiRISE and CTX are grayscale images, walking mode applies a filter that paints the grays with the Martian soil palette.

## Interface

The map fills the screen and the panels float on top, like planet explorers do:

- **Top bar:** search for places on Mars (name or "lat, lon"; shortcut `/`), mode switch, Telemetry, Landmarks, ARES and Data.
- **Left panel (1 · Prepare the walk):** pre-walk checklist, suit payload, layers and destinations. It folds away with the side tab.
- **Right panel (2 · Walk plan):** verdict, route numbers, elevation profile, schedule, alerts and stops.
- **Bottom right corner:** enter the Helmet view, switch 3D/2D, point north and zoom.
- **Bottom left corner:** quick switch of the background image.
- **Bottom bar:** two groups. **Simulation** plays the planned walk (▶, time bar, Mars clock, phase and speed). The actions are **Follow live** (the live walk panel), **NASA link · live** (cuts the Earth–Mars link) and **Return to base** (fastest way back); in the footer, the position under the cursor and the camera altitude.

The look follows the team's landing page: warm charcoal, ivory and terracotta, Manrope for text and small uppercase mono labels. Muted green, ochre and brick appear only as status (GO / CAUTION / NO-GO).

## Operating modes

The button at the top switches between the two modes the skill asks for:

- **`HABITAT PLANNER`**: a wide view for planning the route. It has three tabs:
  - **3D globe**: all of Mars in CesiumJS, with the Martian ellipsoid (3396.2 / 3376.2 km), real terrain and the high-resolution images of Jezero.
  - **Map**: a 2D map (Leaflet) with the same layers.
  - **Telemetry**: gauges and charts of the walk, plus the contract blocks (MEDA environment, mobility, topography, position).
- **`HELMET HUD`**: a compact interface from inside the visor. It shows what comes from the contract (O₂, buddy, support rover, suit payload, slope and safe limit, alerts) over the view of Mars. The view has two sources: **Rover photos** (real Navcam panoramas; you can walk along the rover's path, and the **Mastcam-Z 360°** button opens the nearest color panorama) and **3D terrain** (built only from orbital data, works anywhere on Mars).

Other components:

- **"1st Person Ground Truth" pop-up**: clicking any science target or point of interest opens the real ground photo taken by Perseverance (`optical_first_person_url` from the contract; if missing, the nearest Navcam photo), with position, elevation, slope, mineral and geological context.
- **Routes colored by danger**: the walking route and the rover traverse are colored by slope (green up to 4°, amber from 4° to 8°, red above 8°).
- **Suit payload**: the safe slope limit comes from the contract (`max_safe_slope_deg`, 12° with 18.5 kg; 15° with no payload) and is the limit used in the route calculation.
- **HUD at 1 Hz**: the HUD and telemetry texts update once per second.
- **Step-by-step itinerary**: each leg of the walk with heading, distance, time, arrival time, forecast oxygen and maximum slope.
- **Copilot voice**: ARES speaks with the natural female English voice when the browser has one (Google US English in Chrome; Aria, Jenny, Ava or Emma in Edge), with a radio beep first.

## How to run

1. Start the backend (port 3000):

```bash
cd backend && npm install && npm start
```

2. Serve the frontend (port 5183, already allowed in the backend's CORS):

```bash
cd frontend && python -m http.server 5183
```

3. Open http://localhost:5183.

**Single port (production / VPS):** the backend also serves the frontend. Just start the backend and open http://localhost:3000. In that case the API is called on the same origin, with no CORS. With Docker, from the repository root:

```bash
docker build -t aresnav .
```

```bash
docker run -d -p 3000:3000 --read-only --tmpfs /tmp --security-opt=no-new-privileges:true --cap-drop=ALL --user 1000:1000 aresnav
```

To point to another backend address, set `window.ARESNAV_API` in `config.js`. If you use another port for the frontend during development, add that origin to `ALLOWED_ORIGIN` in the backend's `.env`.

## Demo for the judges

- **Suit payload:** the "Samples and equipment payload" slider (0 to 25 kg) instantly changes the slope limit (`max(8, 15 − 0.2 × kg)`) and the consumption (`1 + 0.018 × kg`). The route is recomputed; if there is no path within the limit or the oxygen forecast on return drops below 30%, the verdict becomes `NO-GO · too steep` or `NO-GO · not enough O₂`, the visor shows an alert and the browser speaks the warning. The formulas are in `physics.js` and are tested in `tests/physics-test.js`.
- **Link cut:** the **NASA link · live** button, next to ▶, simulates the Earth–Mars link going down. The app switches to local data and the backend cache only, and navigation keeps working.
- **Crew:** in the Helmet view, the left panel shows you, your buddy (distance from the contract, a sample value) and the support rover with the computed distance to the extraction point.
- **Ways to move:** in the Helmet's 3D terrain, **On foot**, **Rover** and **Free flight** (see above). The walk simulation runs at 1× (real time), 60× and 360×.
- **Provenance:** the footer shows where the data comes from and the EvidenceGate SHA-256 seal read from the backend.

## Walk safety and copilot

Ideas taken from MMGIS, ATLAS, Marswalk Planner, MIT SEXTANT, FU Berlin and NASA SUITS, implemented with our own data:

- **Three-level verdict** (`GO`, `CAUTION`, `NO-GO`). The **Why?** button shows:
  - the reasons with numbers (for example `Max slope 14.2° exceeds 12.0° limit for 15.0 kg payload`);
  - the time out and the time back, which differ because the climb on the way out becomes a descent on the way back (Tobler's function with the suit mass);
  - the **turn-back point**: how far you can go and still return with 30% O₂;
  - the calibration note. The app compares our terrain with the elevation Perseverance measured at each stop of the official route. Today that is **613 stops, mean offset +19.2 m, σ 19.1 m (RMS 27.1 m)**. The number is computed live, not hard-coded.
- **Radio:** line of sight from the habitat (2 m antenna) to the helmet (1.7 m), over the real terrain and including Mars' curvature, like the MMGIS Sightline tool. It shows "Radio: direct to the habitat" or "Radio: terrain blocks it, relay via MRO" in the status bar and in Telemetry.
- **Provenance labels** on every Telemetry number: `MEASURED` (MEDA, rover stops), `DEM-DERIVED` (terrain) or `SIMULATED` (suit model).
- **Export GeoJSON:** downloads `aresnav-mission-plan.geojson` with:
  - the route, the stops and the turn-back point;
  - the verdict, the reasons and the payload;
  - the radio, the calibration and the Mars time;
  - the SHA-256 hash of the telemetry and of the plan itself.
- **On the map and the globe:**
  - **short vs. safe route:** the dangerous direct route in dashed red and the safe detour in green;
  - **walking reach** of 15 and 30 min from the base;
  - **reachable science:** which targets can be visited with the current payload;
  - **level of the ancient lake** of Jezero (−2400 m, approximate).
- **All of Mars (as in ATLAS):**
  - dust (MGS TES), soil firmness (thermal inertia, MGS TES) and roughness (MGS MOLA);
  - 13 landing sites and the 51 human exploration zones from NASA's 2015 workshop;
  - a 10° grid and the **current Sun**: real day and night from the time on Mars.
- **Mars clock** in the status bar: local mean solar time at Jezero (LMST), Mars 2020 mission sol and Ls. Uses the NASA GISS Mars24 algorithm.
- **ARES, the AI copilot** (button at the top). Ask by text or voice: "Can I go out?", "Where do I turn back?", "Does the radio work on the route?".
  - The app sends the backend a summary of the walk state, and the backend asks Claude (`claude-opus-5-5`, with a server fallback if the model refuses).
  - The answer is spoken over the helmet radio.
  - With no API key, or no network, ARES answers in **local mode**, with the same math as the app.
  - To turn the AI on, put `ANTHROPIC_API_KEY` in `backend/.env`.

## FU Berlin's Jezero

The Jezero WebGIS of Freie Universität Berlin (`maps.planet.fu-berlin.de/jezero`) is a data source, always through the backend:

- **Default image "Jezero in natural color":** a HiRISE 25 cm + CTX + HRSC mosaic already in color, without the artificial tint we used on the grayscale images.
  - Their WMS accepts degrees (EPSG:4326), so each tile of our map becomes a `GetMap` request for that rectangle.
  - Tiles are cached on disk, with at most 4 simultaneous requests to the university's server.
- **Contour lines** (optional layer).
- **Vector layers** in `backend/data/fub/`, served by `/api/v1/fub/:layer`:
  - the shoreline of the ancient lake;
  - 20 channels (Neretva, Sava, Pliva);
  - the Perseverance landing ellipse;
  - 64 360° panorama points (Mastcam-Z and synthetic scenes, such as the full lake). Clicking a point opens the **app's own 360° viewer** (`pano360.js`).
    - The viewer builds the krpano cube with CSS 3D, without a library. It also reprojects spherical panoramas into a cube, on a canvas, and loads sharper tiles as you zoom in.
    - Each panorama has a "natural color" version and a "mineral enhanced" version.
    - Tiles go through `/api/v1/fub/pano/...` and are cached on disk.
    - The format of each panorama (folder, level and whether it is spherical) comes from FU Berlin's `tour.xml`, read by `tools/build-fub-cache.py`. In krpano, the first number of `multires` is the tile size.
- **How the data was generated:** their WFS only speaks EPSG:49911 (Mars, equidistant cylindrical, R = 3 396 190 m). `tools/build-fub-cache.py` downloads the layers and converts them to degrees (x/R, y/R). The conversion matches the bounds the server itself reports.
- **Required credits:** HRSC: ESA/DLR/FU Berlin (CC BY-SA 3.0 IGO); CTX: NASA/JPL-Caltech/MSSS; HiRISE: NASA/JPL/University of Arizona (Fergason et al., 2020). They are in the app's footer.

## Data (NASA, ESA/DLR and FU Berlin, always through the backend)

| Layer | Mission / instrument | Service |
|---|---|---|
| Global color mosaic | Viking Orbiter | Mars Trek WMTS `Mars_Viking_MDIM21_ClrMosaic_global_232m` |
| 25 cm imagery | MRO / HiRISE | Mars Trek WMTS `JEZ_hirise_soc_006_orthoMosaic_25cm_...` |
| 6 m imagery | MRO / CTX | Mars Trek WMTS `JEZ_ctx_B_soc_008_orthoMosaic_6m_...` |
| Landing mosaic | HiRISE + CTX + HRSC | Mars Trek WMTS `NES_JEZ_MID_Visible_Mosaic_...` |
| Color relief | MGS MOLA + Mars Express HRSC | Mars Trek WMTS `Mars_MOLA_blend200ppx_HRSC_ClrShade_...` |
| Global terrain of the 3D globe | MGS MOLA | Mars Trek ImageServer `mola128_mola64_merge_90Nto90S_SimpleC_clon0` (copy in `data/`) |
| Elevation for the route | MOLA + HRSC, 200 m | Mars Trek ImageServer `Mars_MOLA_blend200ppx_HRSC_DEM_...` |
| 1 m terrain along the route | MRO / HiRISE DTM | USGS Astrogeology (`JEZ_hirise_soc_006`, range reads) |
| Daytime infrared | Mars Odyssey / THEMIS | Mars Trek WMTS `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` |
| Hydrated minerals | MRO / CRISM | Mars Trek FeatureServer `Hydrous_Mineral_Detections_OMEGA_CRISM_clon0` |
| Perseverance traverse | Mars 2020 | Mars Trek FeatureServer `Perseverance_Traverse_Path` |
| Helmet mode photos | Mars 2020 / Navcam | `mars.nasa.gov/rss/api` (raw images) |
| Dust, thermal inertia | MGS / TES | Mars Trek WMTS `TES_Dust`, `TES_Thermal_Inertia` |
| Roughness | MGS / MOLA | Mars Trek WMTS `mola_roughness` |
| Human exploration zones | NASA 2015 workshop | Mars Trek MapServer `EZMars` (`/api/v1/zones`) |
| Terrain calibration | Mars 2020 | Official rover stops (`/api/v1/waypoints`, field `elev_geoid`) |

The table in the app (**Data**) shows, live, whether each source came from the backend or from the local cache.

### Helmet panoramas

At the end of each drive the rover takes 5 strips of 96° × 26° at horizon height. The app stitches those strips into a 360° panorama using the mast angle (photo metadata) and the rover heading (official list of stops). `data/pano/index.json` stores, for each rover stop with a complete panorama, the position, the heading and the photo addresses (the photos stay hosted by NASA). With a link, the app swaps the JPEG preview for NASA's original 1280 px PNG. To regenerate:

```bash
python tools/build-pano-cache.py
```

The script reads the stops in `backend/data/cache/m20_waypoints.cached.json` and queries the raw image API slowly, because it blocks bursts of requests.

Controls: drag to look around; `↑` `↓` (or the buttons) move to the next or previous rover stop; `←` `→` turn.

### Helmet 3D terrain

It uses the same globe as the 3D globe mode, with the camera at eye height. `W`/`S` or `↑`/`↓` move, `A`/`D` or `←`/`→` turn, `Shift` goes faster, and the "Go to…" menu takes you to other places on Mars. Near the feet, the visor draws small rocks, pebbles and sand ripples (illustrative, for scale). In Jezero the image is 25 cm HiRISE; elsewhere on the planet it is the 232 m Viking mosaic, so it gets blurry up close.

## What is real and what is simulated

- **Real:** imagery, terrain, slope, the rover traverse, CRISM detections, Navcam photos, positions of the points of interest.
- **From the contract (backend):** remaining O₂, buddy distance, support rover, suit payload, slope and safe limit, MEDA, science targets and alerts. Today the backend serves sample values from `CONTRATO_API.json`.
- **Simulated in the frontend:** heart rate, pace, battery and the oxygen forecast along the walk. They are computed from the real slope of the route.
- **Hypothetical:** the Ares-1 base.
- **Dates:** the 13 landing sites use the coordinates published by the missions. They do not come from a service.

## Known limitations

- The 1 m HiRISE terrain sits up to ~28 m below the 200 m terrain in Jezero (it uses another height reference). The app measures that offset on each 256 m block and removes it, so HiRISE only adds the fine detail and the blocks blend in without steps.
- The route terrain has 200 m resolution. It is good for choosing the general path, but it hides boulders and steps. The 1 m HiRISE terrain checks the route corridor afterwards (only inside the mosaic area around the landing site), but it does not change the chosen path yet.
- Outside Jezero, the on-demand terrain is about 230 m per point and the image is 100 m THEMIS with Viking color: up close, on the ground, it is blurry. The geometry (mountains, craters, canyons) is real.
- Voice quality depends on the voices installed in the presenter's browser.
- The skill mentions the layer `Mars_MGS_MOLA_ClrShade_blend_mola_128ppd`, but that address answers 404 on Mars Trek. The app uses the equivalent `Mars_MOLA_blend200ppx_HRSC_ClrShade` (MOLA + HRSC).
- The Helmet compass is approximate: it uses the rover heading from the photo metadata, without correcting for the terrain tilt.
- The Navcam panorama strips are black and white and get a color tint in the app. They cover 26° in height, so a plain background shows above and below.
- Not every rover stop has a complete panorama. The visor footer shows the sol and the stop of each photo.
- The safe slope limit is 12°, the same `max_safe_slope_deg` as in `CONTRATO_API.json`.

## Structure

- `index.html`, `style.css`: page and look
- `config.js`, `boot.js`: configuration and startup (no inline scripts in the HTML, because of the CSP)
- `physics.js`: suit payload physics (slope limit, consumption, verdict)
- `app.js`: backend access, contract, route (A*), walk simulation, 2D map, checklist, plan and the ground photo pop-up
- `globe.js`: 3D globe (CesiumJS) and moving in the Helmet's 3D terrain
- `hirise-core.js`: 1 m HiRISE terrain (tiles, decoding, route corridor)
- `helmet.js`: Helmet mode (rover photos and 3D terrain)
- `ui.js`: interface shell (panels, search, map controls, status bar)
- `i18n.js`: English translation of everything on screen
- `telemetry.js`: Telemetry mode
- `mission.js`: Why?, radio, GeoJSON export, route comparison, reach, reachable science, lake, global layers and the Mars clock
- `copilot.js`: ARES, the copilot (AI through the backend, or local mode)
- `exec-core.js`, `execution.js`: running the walk live (engine and panel)
- `pano360.js`, `pano-tiles.js`: the 360° viewer
- `data/`: local redundancy (terrain, traverse, telemetry and `tiles/`) and the panorama index
- `../tools/build-pano-cache.py`: builds the panorama index
