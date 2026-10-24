"""Small WGS84 polyline utilities for matching existing public walkways."""
import hashlib
import json
import math


def xy(point):
    return point[0] * 95_800, point[1] * 110_540


def metres(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((b[0] - a[0]) * 111_320 * math.cos(lat), (b[1] - a[1]) * 110_540)


def fingerprint(coords):
    return hashlib.sha256(json.dumps(coords, separators=(',', ':')).encode()).hexdigest()


def route_key(coords):
    """Ignore collinear roof split points when deciding whether routes differ."""
    kept = []
    for point in coords:
        kept.append(point)
        while len(kept) >= 3:
            a, b, c = [xy(p) for p in kept[-3:]]
            dx, dy = c[0] - a[0], c[1] - a[1]
            length = math.hypot(dx, dy)
            projection = (b[0] - a[0]) * dx + (b[1] - a[1]) * dy
            if length and 0 <= projection <= length ** 2 and abs(dx * (b[1] - a[1]) - dy * (b[0] - a[0])) / length < 0.01:
                kept.pop(-2)
            else:
                break
    return tuple((round(p[0], 6), round(p[1], 6)) for p in kept)


def merge_ranges(ranges):
    out = []
    for start, end in sorted(ranges):
        if out and start <= out[-1][1] + 1e-9:
            out[-1][1] = max(out[-1][1], end)
        else:
            out.append([start, end])
    return out


def fraction_ranges(ranges):
    # Arclength sums can overshoot 1 by a few floating-point ulps.
    cleaned = [[max(0.0, min(1.0, round(a, 12))), max(0.0, min(1.0, round(b, 12)))]
               for a, b in ranges]
    return merge_ranges([r for r in cleaned if r[1] > r[0]])


def lengths(coords):
    steps = [metres(a, b) for a, b in zip(coords, coords[1:])]
    return steps, sum(steps)


def slice_line(coords, start, end):
    """Fractional arclength slice, retaining every bend in the original line."""
    steps, total = lengths(coords)
    if total <= 0:
        raise ValueError('Zero-length geometry')
    low, high, walked, result = start * total, end * total, 0.0, []
    for a, b, step in zip(coords, coords[1:], steps):
        if step and walked + step >= low and walked <= high:
            lo = max(0, (low - walked) / step)
            hi = min(1, (high - walked) / step)
            for t in (lo, hi):
                point = [a[i] + (b[i] - a[i]) * t for i in (0, 1)]
                if not result or metres(result[-1], point) > 1e-6:
                    result.append(point)
        walked += step
    if len(result) < 2:
        raise ValueError('Empty geometry slice')
    return result


def line_overlap(coords, source, tolerance=0.4):
    """Ranges of an existing edge collinear with an explicitly mapped path.

    Proximity alone is insufficient: both source segment endpoints must lie on
    the edge's supporting line before any overlap is accepted.
    """
    steps, total = lengths(coords)
    if total <= 0:
        return []
    walked, ranges = 0.0, []
    for a, b, step in zip(coords, coords[1:], steps):
        ax, ay = xy(a); bx, by = xy(b)
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        if norm:
            for c, d in zip(source, source[1:]):
                cx, cy = xy(c); ex, ey = xy(d)
                if max(abs(dx * (cy - ay) - dy * (cx - ax)),
                       abs(dx * (ey - ay) - dy * (ex - ax))) / norm > tolerance:
                    continue
                t = sorted([((cx - ax) * dx + (cy - ay) * dy) / norm ** 2,
                            ((ex - ax) * dx + (ey - ay) * dy) / norm ** 2])
                low, high = max(0, t[0]), min(1, t[1])
                if high > low and (high - low) * step >= 0.5:
                    ranges.append([(walked + low * step) / total,
                                   (walked + high * step) / total])
        walked += step
    return fraction_ranges(ranges)


def inside(point, polygon):
    x, y = point
    result = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            result = not result
    return result


def polygon_overlap(coords, polygon):
    """Exact segment/polygon intersections, without painting a whole edge."""
    steps, total = lengths(coords)
    walked, ranges = 0.0, []
    if total <= 0:
        return ranges
    for a, b, step in zip(coords, coords[1:], steps):
        dx, dy = b[0] - a[0], b[1] - a[1]
        cuts = [0.0, 1.0]
        for c, d in zip(polygon, polygon[1:] + polygon[:1]):
            ex, ey = d[0] - c[0], d[1] - c[1]
            denom = dx * ey - dy * ex
            if abs(denom) < 1e-20:
                continue
            px, py = c[0] - a[0], c[1] - a[1]
            t, u = (px * ey - py * ex) / denom, (px * dy - py * dx) / denom
            if 0 <= t <= 1 and 0 <= u <= 1:
                cuts.append(t)
        cuts = sorted(set(cuts))
        for low, high in zip(cuts, cuts[1:]):
            t = (low + high) / 2
            if (high - low) * step >= 0.5 and inside([a[0] + t * dx, a[1] + t * dy], polygon):
                ranges.append([(walked + low * step) / total, (walked + high * step) / total])
        walked += step
    return fraction_ranges(ranges)
