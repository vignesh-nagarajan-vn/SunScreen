"""Shadow-casting sanity checks. Run: python test_shade.py"""
import importlib.util
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location("shade", Path(__file__).with_name("03_shade.py"))
shade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shade)

GROUND = np.zeros((100, 100), np.float32)
BLOCK = GROUND.copy()
BLOCK[40:60, 40:60] = 20  # 20 m tall, 20 m wide block in the middle


def test_block_shadow_length():
    """A 20 m block under a 45 degree sun casts a ~20 m shadow."""
    mask = shade.cast_shadows(BLOCK, GROUND, azimuth=90, altitude=45)  # sun due east
    west = mask[50, :40]
    assert abs(west.sum() - 20) <= 1, west.sum()
    assert not mask[50, 60:].any()  # nothing on the sunny side


def test_shadow_points_away_from_sun():
    """Rows grow southward (north-up raster), so a southern sun shades the north side."""
    mask = shade.cast_shadows(BLOCK, GROUND, azimuth=180, altitude=45)
    assert mask[20:40, 50].sum() >= 19 and not mask[60:, 50].any()


def test_low_sun_casts_longer_shadow():
    """Shadow length = height / tan(altitude): 20 m at 30 degrees is ~35 m."""
    mask = shade.cast_shadows(BLOCK, GROUND, azimuth=90, altitude=30)
    assert abs(mask[50, :40].sum() - 20 / np.tan(np.radians(30))) <= 2, mask[50, :40].sum()


def test_flat_ground_and_night():
    assert not shade.cast_shadows(GROUND, GROUND, azimuth=180, altitude=45).any()
    assert shade.cast_shadows(GROUND, GROUND, azimuth=270, altitude=-3).all()  # sun below the horizon


if __name__ == "__main__":
    for name, test in list(globals().items()):
        if name.startswith("test_"):
            test()
            print(f"ok  {name}")
