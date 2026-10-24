"""A 20 m block under a 45 degree sun should cast a ~20 m shadow. Run: python test_shade.py"""
import importlib.util
from pathlib import Path

import numpy as np

spec = importlib.util.spec_from_file_location("shade", Path(__file__).with_name("03_shade.py"))
shade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shade)


def test_block_shadow_length():
    ground = np.zeros((100, 100), np.float32)
    surface = ground.copy()
    surface[40:60, 60:70] = 20  # 20 m tall block
    mask = shade.cast_shadows(surface, ground, azimuth=90, altitude=45)  # sun due east
    west_of_block = mask[50, :60]
    assert abs(west_of_block.sum() - 20) <= 1, west_of_block.sum()
    assert not mask[50, 70:].any()  # nothing on the sunny side


if __name__ == "__main__":
    test_block_shadow_length()
    print("ok: 20 m block at 45 deg casts a ~20 m shadow")
