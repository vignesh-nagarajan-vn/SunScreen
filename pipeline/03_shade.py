"""Sun positions + one shade mask per 30-min slot (07:00-20:00) -> data/shade/shade_HHMM.tif.

solweig is not on PyPI, so shadows come from a vectorized numpy stepped projection
over the DSM + CHM surface. Pixels under overhead cover (CHM or DSM-DTM > 2.5 m)
count as shaded at all times. Mask value 1 = shaded.
"""
import argparse
import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pvlib
import rasterio

DATA = Path(__file__).resolve().parents[1] / "data"
TZ = "America/Chicago"
COVER_M = 2.5
SLOTS = [f"{m // 60:02d}{m % 60:02d}" for m in range(7 * 60, 20 * 60 + 1, 30)]


def shift(a, dr, dc):
    """out[r, c] = a[r + dr, c + dc]; -inf outside the raster."""
    h, w = a.shape
    out = np.full_like(a, -np.inf)
    r0, r1 = max(0, -dr), min(h, h - dr)
    c0, c1 = max(0, -dc), min(w, w - dc)
    if r0 < r1 and c0 < c1:
        out[r0:r1, c0:c1] = a[r0 + dr:r1 + dr, c0 + dc:c1 + dc]
    return out


def cast_shadows(surface, ground, azimuth, altitude, res=1.0, max_dist=500.0, eps=0.5):
    """True where the line from a ground pixel toward the sun is blocked by the surface.

    azimuth: degrees clockwise from north. altitude: degrees above the horizon.
    Rasters are north-up, so moving toward the sun is row -cos(az), col +sin(az).
    """
    if altitude <= 0:
        return np.ones(ground.shape, bool)
    tan_alt = np.tan(np.radians(altitude))
    az = np.radians(azimuth)
    reach = min(max_dist, (surface.max() - ground.min()) / tan_alt)
    shade = np.zeros(ground.shape, bool)
    seen = set()
    for d in np.arange(res, reach + res, res):
        dr = int(round(-np.cos(az) * d / res))
        dc = int(round(np.sin(az) * d / res))
        if (dr, dc) in seen:
            continue
        seen.add((dr, dc))
        dist = np.hypot(dr, dc) * res
        shade |= shift(surface, dr, dc) - dist * tan_alt > ground + eps
    return shade


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--date", type=date.fromisoformat, default=date.today(), help="YYYY-MM-DD (default: today)")
    args = p.parse_args()

    area = json.loads((DATA / "area.json").read_text())
    west, south, east, north = area["bbox_wgs84"]
    lat, lon = (south + north) / 2, (west + east) / 2

    def read(name):
        with rasterio.open(DATA / f"{name}.tif") as src:
            return src.read(1), src.profile

    dtm, profile = read("dtm")
    dsm, _ = read("dsm")
    chm, _ = read("chm")
    surface = np.maximum(dsm, dtm + chm)
    covered = (chm > COVER_M) | (dsm - dtm > COVER_M)
    print(f"overhead cover: {covered.mean():.0%} of pixels")

    times = pd.DatetimeIndex([pd.Timestamp(f"{args.date} {s[:2]}:{s[2:]}", tz=TZ) for s in SLOTS])
    sun = pvlib.solarposition.get_solarposition(times, lat, lon)
    # Clear-sky direct beam; the API compares it with the forecast to get a cloud factor.
    clear = pvlib.location.Location(lat, lon, TZ).get_clearsky(times, model="ineichen", solar_position=sun)

    out = DATA / "shade"
    out.mkdir(exist_ok=True)
    profile.update(dtype="uint8", nodata=None, compress="deflate")
    meta = {"date": str(args.date), "lat": lat, "lon": lon, "slots": {}}
    for slot, (_, s), dni in zip(SLOTS, sun.iterrows(), clear["dni"]):
        alt, az = float(s["apparent_elevation"]), float(s["azimuth"])
        mask = cast_shadows(surface, dtm, az, alt) | covered
        with rasterio.open(out / f"shade_{slot}.tif", "w", **profile) as dst:
            dst.write(mask.astype("uint8"), 1)
        meta["slots"][slot] = {"altitude": round(alt, 2), "azimuth": round(az, 2), "clearsky_dni": round(float(dni), 1)}
        note = "  (sun below horizon: all shaded)" if alt <= 0 else ""
        print(f"{slot}  alt {alt:5.1f}  az {az:5.1f}  shaded {mask.mean():5.1%}{note}")
    (out / "sun.json").write_text(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
