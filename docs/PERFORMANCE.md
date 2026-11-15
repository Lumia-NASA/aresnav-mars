# AresNav performance

Measured on November 14, 2026 on a Windows 11 laptop with Chrome, running the backend locally (`node backend/server.js`). "Phone" means the same machine with the screen emulated at 375 × 812. **It has not been measured on a real phone yet.** A phone's CPU and GPU are slower, so the 360° viewer and globe times should go up there.

## Initial load

| | Before | After |
|---|---|---|
| API data over the network | 2,696 KB | **570 KB** |
| API requests at startup | 14 | 13 |
| App ready (route, verdict and map) | ~2.0 s | ~2.0 s |
| JS memory after loading | 43 MB | 34–38 MB |

What changed:

| Data | Before | After | How |
|---|---|---|---|
| Perseverance traverse | 1,487 KB | 450 KB | brotli compression in the backend |
| River channels (FU Berlin) | 384 KB | 17 KB | 5 m Douglas-Peucker + brotli |
| Lake shoreline (FU Berlin) | 142 KB | 14 KB | 5 m Douglas-Peucker + brotli |
| Rover stops | 526 KB at startup | 93 KB, only when opening "Why?" or exporting | loaded on demand |

Time to ready is dominated by NASA's response for the traverse (~1.4 s) and the terrain (~1.2 s), requested in parallel. With the cache and no internet, it drops to disk time.

The 5 m simplification changes nothing visible: the terrain used for the route is 200 m per point.

## 360° viewer

| Panorama | Tiles | Time to complete |
|---|---|---|
| Mastcam-Z photo (cube, 1,024 px per face) | 24 | 2.8 s |
| Synthetic view (cube, 1,280 px per face) | 54 | 3.1 s |
| Sphere reprojected to a cube | 6 | 0.4–1.5 s |

- Reprojecting the sphere into 6 faces of 512 px costs **~150 ms** of CPU on the laptop.
- Opening and closing several panoramas does not grow memory (38 MB before and 37 MB after). The viewer drops its tiles on close.
- Tiles are cached on the backend's disk. The second time, the panorama opens in a fraction of a second and works offline.

## Loaded only when needed

- **Natural color tiles (FU Berlin WMS):** only from level 8 (~300 km altitude) and only in the Jezero area. At most 4 simultaneous requests to the university's server.
- **Dust, firmness and roughness (TES/MOLA):** only when the layer is turned on.
- **Panoramas:** no tiles before opening.
- **Rover stops:** only when opening "Why?" or exporting.

## Still to measure

- **Globe smoothness in frames per second.** The browser pane used in the tests was in the background, and the browser throttles the frame rate in that case. It needs to be measured with the window visible.
- **A real phone:** 360° time, memory and heat.
- **Slow network (3G):** compression helps, but the traverse is still 450 KB.

## How to repeat

1. Open the app, press F12, **Network** tab, reload and add up the "Transferred" column for requests to `/api/v1/`.
2. In the console: `performance.memory.usedJSHeapSize / 1048576` (Chrome only).
3. 360° viewer: open a point and time it until the "Loading…" bar disappears. For exact numbers, use `App.pano360.load`.
