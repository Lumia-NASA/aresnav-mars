# Model assumptions and sensitivity

The AresNav verdict (GO / CAUTION / NO-GO) is a **planning simulation**. It combines real data (terrain, the rover traverse, imagery) with a suit model that **has not been validated** with astronauts, real suits or NASA standards. This page lists each assumption and how much it weighs on the result, so the team and the judges can decide how far to trust each number.

The parameters live in `frontend/physics.js` (`SLOPE_RULE` and `ALGORITHM`, version 1.3.0) and are included in the exported GeoJSON.

## The assumptions

| Assumption | Value used | Where it comes from | Status |
|---|---|---|---|
| Slope limit with payload | 15° − 0.2° per kg, floor of 8° | AresNav design choice | **simulation assumption**, not a validated EVA limit |
| O₂ endurance | 480 min | order of magnitude of an 8 h EVA | assumption |
| Minimum O₂ reserve on return | 30% | AresNav design margin | assumption |
| Extra consumption per kg | +1.8% per kg | design choice | assumption |
| Pace lost per kg | −1.2% per kg | design choice | assumption |
| Walking pace (Tobler) | 2.7 km/h on flat ground, peak on a gentle descent | Tobler's function with the v₀ of a suited astronaut (SEXTANT/Apollo reference) | classic shape; the v₀ value is an assumption |
| Habitat antenna and helmet | 2 m and 1.7 m | design choice | assumption (a taller antenna changes the radio result a lot) |
| Moving in the 3D terrain: on foot | eyes at 1.7 m, 0.8 m/s (Shift 1.6 m/s), 0.7 m stride | design choice, visualization only | assumption; does not feed the O₂ math or the verdict |
| Moving in the 3D terrain: crewed rover | eyes at 2.4 m, 10 km/h (Shift 15 km/h), stops on climbs above 20° or side tilt above 25° | order of magnitude of pressurized rovers studied by NASA; AresNav values | **assumption**, visualization only; planning is still for a walk on foot |
| Jump on foot (Space) | 1.6 m/s push-off, Mars gravity 3.71 m/s²: ~0.35 m and ~0.86 s in the air (Earth: 0.13 m, 0.33 s) | push-off speed is an AresNav value; gravity is the real Mars value | **assumption** for the push-off, visualization only |
| Astronaut and rover in third person | built from simple shapes, ~1.9 m astronaut and ~5 m rover | illustrative | **illustration**, not a real suit or vehicle model |
| Rocks and sand near the feet | drawn in the visor up to ~20 m | illustrative (orbital imagery does not show centimeter-sized rocks) | **illustration**, not data |
| Terrain | HRSC + MOLA, 200 m per point | NASA Mars Trek | **real data**. Cannot see boulders or steps; sits on average 19 m above the elevation Perseverance measured at 613 stops (σ 19 m) |
| Route corridor terrain | controlled HiRISE DTM, 1 m (JEZ_hirise_soc_006) | USGS Astrogeology / MRO HiRISE | **real data**. Slope measured over 5 m; the steep-stretch limit is the route limit. Differs from the 200 m terrain by 3 to 6 m at the base |
| Weather: temperature and pressure (MEDA) | minimum, maximum and pressure of the latest published sol | public MEDA feed, through `/api/v1/weather` | **real, dated measurement**, not a live reading. The app shows the date and the age of the data; the latest public sol is from April 2024 |
| Weather: wind, radiation and dust | contract values | `CONTRATO_API.json` | **sample values** (SAMPLE label). The public MEDA feed does not carry these quantities |
| Sunrise and sunset | computed for today's date | Mars24 algorithm, in `frontend/mars-sun.js` | **computed**, checked against MEDA times (less than 1 min apart) |

### The two weather sets

The weather panel mixes two sources, and the app separates them with labels:

- **Dated measurements (MEASURED):** minimum temperature, maximum temperature and pressure come from Perseverance's MEDA sensor. They are real but old: NASA publishes only the latest sols, and the most recent one available is from April 2024. That is why the app always shows the date and how many days old the data is. If NASA is down, the last cached copy is used, with the same date.
- **Sample values (SAMPLE):** wind, radiation and dust are not in the public feed. The app shows the fixed numbers from `CONTRATO_API.json` only to fill the panel. They do not describe the weather in Jezero on any day.

The weather values (temperature, pressure, wind, radiation, dust) do not feed the verdict math: it depends on terrain, payload, oxygen, radio and daylight, and daylight uses the computed sunset. The only thing that counts is the **age** of the measurement, as a caveat in the checklist: when the data is more than 30 days old, a GO shows as "GO · with caveats". Since the latest public sol is from 2024, that caveat is always present today.

## How much each assumption moves the result

Case used: the default demo walk, to the Three Forks sample depot. It is 3.73 km out, with 214 min walking and 71 min stopped, carrying 18.5 kg. The default result is **21% O₂ on return: NO-GO**, because the minimum is 30%.

| Change (one at a time) | O₂ on return | Verdict |
|---|---|---|
| None (default) | 21% | NO-GO |
| Endurance −10% (432 min) | 12% | NO-GO |
| Endurance +10% (528 min) | 28% | NO-GO |
| Consumption per kg −25% (1.35%/kg) | 26% | NO-GO |
| Consumption per kg +25% (2.25%/kg) | 16% | NO-GO |
| Pace per kg −25% (0.9%/kg) | 25% | NO-GO |
| Pace per kg +25% (1.5%/kg) | 16% | NO-GO |
| 13.5 kg payload (the app's suggestion) | 30% | CAUTION (at the limit) |
| 10 kg payload | 36% | CAUTION |
| No payload | 51% | GO on O₂ (radio still gives CAUTION) |

**Reading:** with 18.5 kg, this walk is NO-GO for any reasonable variation of the suit parameters. The conclusion "carry less" is robust. The exact number of kilograms suggested (13.5 kg), however, depends on the assumptions and should be read as an order of magnitude.

### Slope rule

Limit with 18.5 kg depending on the parameters:

| Rule | Limit with 18.5 kg |
|---|---|
| Default: 15° − 0.2°/kg | 11.3° |
| Base 13° | 9.3° |
| Base 17° | 13.3° |
| 0.15°/kg (−25%) | 12.2° |
| 0.25°/kg (+25%) | 10.4° |

For a route that peaks at 11°, the payload at which it becomes NO-GO drops from 20.5 kg to 10.5 kg if the base is 13° instead of 15°. That calculation is in `tests/physics-test.js`. The slope rule is the **most sensitive** assumption in the model. That is why the app calls it a "simulated rule" and the "Why?" card warns that it is not a validated limit.

## What would change this in a real project
- Slope and consumption limits measured with the suit in trials (for example, data from NASA analog walks).
- 1 m HiRISE terrain also used to choose the path (today it only checks the corridor of the 200 m route and provides the Helmet's ground).
- Weather for the day of the walk, with measured wind, radiation and dust. Today only temperature and pressure are measurements, and from an old sol (the exported GeoJSON records the age of the data).
