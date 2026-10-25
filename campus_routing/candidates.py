"""Bounded, loop-free candidates that explicitly traverse a documented passage."""
import networkx as nx

from .geometry import metres, route_key


def join_routes(legs):
    nodes = list(legs[0]['path'])
    for leg in legs[1:]:
        if not nodes or nodes[-1] != leg['path'][0]:
            return None
        nodes.extend(leg['path'][1:])
    # A detour around a block and back to the same node is not a useful shade
    # option. Forcing a passage must never introduce such a loop.
    if len(nodes) != len(set(nodes)):
        return None
    coords, runs, building_runs = [], [], []
    length = shaded = indoor = covered = 0.0
    for leg in legs:
        offset = max(len(coords) - 1, 0)
        coords.extend(leg['coords'] if not coords else leg['coords'][1:])
        runs.extend([[a + offset, b + offset, s] for a, b, s in leg['runs']])
        building_runs.extend([{**r, 'first': r['first'] + offset, 'last': r['last'] + offset,
                               'start_m': r['start_m'] + length, 'end_m': r['end_m'] + length}
                              for r in leg['building_runs']])
        length += leg['length']
        shaded += leg['length'] * leg['shade']
        indoor += leg['indoor_m']
        covered += leg['covered_passage_m']
    return {'path': tuple(nodes), 'coords': coords, 'route_key': route_key(coords), 'length': length,
            'shade': shaded / length if length else 1, 'runs': runs, 'building_runs': building_runs,
            'indoor_m': indoor, 'covered_passage_m': covered}


def passage_candidates(graph, rules, source, target, slot, alphas, max_distance, shortest, summarize):
    """Generate explicit through-passage choices the weighted search can miss.

    Straight-line bounds and the shortest feasible approach discard passages
    outside the distance allowance before extra shade searches are attempted.
    The caller still checks opening hours over the complete traversal interval.
    """
    point = lambda n: [graph.nodes[n]['x'], graph.nodes[n]['y']]
    for rule in rules:
        identity = rule['id']
        doors = rule['doors']
        middle = [doors[0]['node'], *[f'passage:{identity}:{i}' for i in range(len(rule['sections']) - 1)], doors[1]['node']]
        interior_length = sum(d['length'] for a, b in zip(middle, middle[1:])
                              for d in graph[a][b].values() if d.get('passage_id') == identity)
        # The approaches can use other documented passages and outdoor cover,
        # but not re-enter the passage that is explicitly required in the middle.
        directions = [middle] if rule.get('oneway') else [middle, list(reversed(middle))]
        for passage_path in directions:
            a, b = passage_path[0], passage_path[-1]
            if metres(point(source), point(a)) + interior_length + metres(point(b), point(target)) > max_distance + 1e-6:
                continue
            for alpha in alphas:
                try:
                    before = shortest(source, a, slot, alpha, graph, excluded_passage=identity)
                    after = shortest(b, target, slot, alpha, graph, excluded_passage=identity)
                    through = summarize(passage_path, graph, slot, alpha, identity)
                except (nx.NetworkXNoPath, nx.NodeNotFound):
                    break
                # Along a fixed graph, increasing this shade weight cannot make
                # its optimal path geometrically shorter. Bound further work.
                if before['length'] + through['length'] + after['length'] > max_distance + 1e-6:
                    break
                candidate = join_routes([before, through, after])
                if candidate is not None:
                    yield candidate
