"""Independent Decimal oracle. All binary64 values cross JSON as raw words."""
import argparse
from decimal import Decimal, localcontext, InvalidOperation, DivisionByZero, Overflow
import json
import math
from pathlib import Path
import random
import struct


def words(value):
    if math.isnan(value):
        return [0, 0x7FF80000]
    return list(struct.unpack('<II', struct.pack('<d', value)))


def number(raw):
    return struct.unpack('<d', struct.pack('<II', *raw))[0]


def ordered(raw):
    bits = raw[0] | raw[1] << 32
    return (~bits & ((1 << 64) - 1)) if bits >> 63 else bits | (1 << 63)


def primitive(a, b, operation):
    with localcontext() as context:
        # Exact decimal expansion of subnormal inputs and their products can
        # exceed 2000 digits. Lower precision biases exact halfway cases before
        # conversion to binary64; do not introduce a decimal double rounding.
        context.prec = 2500
        for signal in (InvalidOperation, DivisionByZero, Overflow):
            context.traps[signal] = False
        x, y = Decimal.from_float(a), Decimal.from_float(b)
        result = [lambda: x + y, lambda: x - y, lambda: x * y, lambda: x / y][operation]()
        return words(float(result))


def eligible(x, y):
    if not math.isfinite(x) or not math.isfinite(y) or x == 0 or y == 0:
        return False
    ex, ey = math.frexp(abs(x))[1] - 1, math.frexp(abs(y))[1] - 1
    maximum = max(ex, ey)
    return -450 <= maximum <= 450 and min(ex, ey) - maximum >= -450


def inverse(x, y):
    with localcontext() as context:
        context.prec = 200
        a, b = Decimal.from_float(x), Decimal.from_float(y)
        denominator = a * a + b * b
        real, imaginary = a / denominator, -b / denominator
        return {'real': words(float(real)), 'imaginary': words(float(imaginary)),
                'decimalReal': str(real), 'decimalImaginary': str(imaginary)}


def generate(seed, count):
    rng = random.Random(seed)
    edges = [0.0, -0.0, math.inf, -math.inf, math.nan, math.ulp(0.0), -math.ulp(0.0),
             2.0 ** -1022, -(2.0 ** -1022), float.fromhex('0x1.fffffffffffffp+1023'),
             1.0, -1.0, 1 + 2.0 ** -52, 2.0 ** -53, math.pi, math.e]
    pairs = [(a, b) for a in edges for b in edges]
    for _ in range(count):
        a, b = (struct.unpack('<d', struct.pack('<Q', rng.getrandbits(64)))[0] for _ in range(2))
        pairs.append((a, b))
    # Explicit cancellation, ties, underflow and overflow neighborhoods.
    for exponent in (-1074, -1022, -1000, -450, -1, 0, 1, 450, 1000, 1023):
        x = 2.0 ** exponent
        pairs.extend([(x, -x), (x, math.ulp(x) / 2), (x, math.nextafter(x, math.inf)), (x, 3.0)])
    primitives = [{'input': [*words(a), *words(b)], 'expected': [primitive(a, b, op) for op in range(4)]} for a, b in pairs]
    inverse_pairs = []
    for maximum in (-451, -450, -449, -1, 0, 1, 449, 450, 451):
        for gap in (0, 1, 52, 449, 450, 451):
            for signs in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
                inverse_pairs.append((signs[0] * 2.0 ** maximum, signs[1] * 2.0 ** (maximum - gap)))
    inverse_pairs.extend((a, b) for a in edges[:10] for b in (0.0, -0.0, 1.0, -1.0))
    for _ in range(count):
        exponent, gap = rng.randint(-450, 450), rng.randint(0, 450)
        x = math.ldexp(1 + rng.random(), exponent)
        y = math.ldexp(1 + rng.random(), exponent - gap)
        inverse_pairs.append((math.copysign(x, rng.choice((-1, 1))), math.copysign(y, rng.choice((-1, 1)))))
    inverses = []
    for x, y in inverse_pairs:
        accepted = eligible(x, y)
        inverses.append({'input': [*words(x), *words(y)], 'eligible': accepted,
                         'expected': inverse(x, y) if accepted else None})
    return {'method': 'python-decimal-binary64-v1', 'primitiveDecimalPrecision': 2500, 'inverseDecimalPrecision': 200, 'seed': seed,
            'randomCount': count, 'inverseUlpLimit': 8, 'primitives': primitives, 'inverses': inverses}


def generate_division_only(seed, count):
    rng = random.Random(seed)
    edges = [0.0, -0.0, math.inf, -math.inf, math.nan, math.ulp(0.0), -math.ulp(0.0),
             2.0 ** -1022, -(2.0 ** -1022), float.fromhex('0x1.fffffffffffffp+1023'),
             1.0, -1.0, 1 + 2.0 ** -52, 2.0 ** -53, math.pi, math.e]
    pairs = [(a, b) for a in edges for b in edges]
    for exponent in (-1074, -1022, -1000, -450, -1, 0, 1, 450, 1000, 1023):
        x = 2.0 ** exponent
        pairs.extend([(x, 0.0), (x, -0.0), (x, 3.0), (x, math.ulp(x)), (x, math.nextafter(x, math.inf))])
    for _ in range(count):
        a, b = (struct.unpack('<d', struct.pack('<Q', rng.getrandbits(64)))[0] for _ in range(2))
        pairs.append((a, b))
    cases = [{'input': [*words(a), *words(b)], 'expected': [None, None, None, primitive(a, b, 3)]}
             for a, b in pairs]
    return {'method': 'python-decimal-binary64-division-only-v1', 'primitiveDecimalPrecision': 2500,
            'seed': seed, 'randomCount': count, 'operations': [3], 'inverseUlpLimit': 8,
            'primitives': cases, 'inverses': []}


def verify(fixture, actual):
    failures, maximum = [], 0
    for run in actual['results']:
        if run.get('error'):
            failures.append({'variant': run['variant'], 'error': run['error']})
            continue
        if run.get('glError') != 0:
            failures.append({'variant': run['variant'], 'type': 'webgl-error', 'actual': run.get('glError')})
        primitive_words = run['primitiveWords']
        size = len(fixture['primitives'])
        for operation in fixture.get('operations', range(4)):
            for index, case in enumerate(fixture['primitives']):
                offset = (operation * size + index) * 4
                observed = primitive_words[offset:offset + 2]
                if observed != case['expected'][operation]:
                    failures.append({'variant': run['variant'], 'type': 'primitive', 'operation': operation,
                                     'index': index, 'expected': case['expected'][operation], 'actual': observed})
        if run.get('inverseWords') is None:
            continue
        raw, size = run['inverseWords'], len(fixture['inverses'])
        for index, case in enumerate(fixture['inverses']):
            accepted = bool(raw[(size + index) * 4])
            if accepted != case['eligible']:
                failures.append({'variant': run['variant'], 'type': 'guard', 'index': index,
                                 'expected': case['eligible'], 'actual': accepted})
            if not accepted or not case['eligible']:
                continue
            for component, start in (('real', 0), ('imaginary', 2)):
                observed = raw[index * 4 + start:index * 4 + start + 2]
                expected = case['expected'][component]
                distance = abs(ordered(observed) - ordered(expected))
                maximum = max(maximum, distance)
                if not math.isfinite(number(observed)) or distance > fixture['inverseUlpLimit']:
                    failures.append({'variant': run['variant'], 'type': 'inverse', 'index': index,
                                     'component': component, 'ulp': distance, 'expected': expected, 'actual': observed})
    return {'method': fixture['method'], 'status': 'passed' if not failures else 'failed',
            'source': actual.get('source'), 'browser': actual.get('browser'),
            'variants': [run['variant'] for run in actual['results']],
            'primitiveCases': len(fixture['primitives']), 'inverseCases': len(fixture['inverses']),
            'failureCount': len(failures), 'failures': failures[:100], 'maxInverseUlp': maximum}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--seed', type=int, default=0xB1642026)
    parser.add_argument('--random', type=int, default=512)
    parser.add_argument('--division-only', action='store_true')
    parser.add_argument('--fixture')
    parser.add_argument('--verify')
    arguments = parser.parse_args()
    if bool(arguments.fixture) != bool(arguments.verify):
        parser.error('--fixture and --verify must be provided together')
    if arguments.verify:
        result = verify(json.loads(Path(arguments.fixture).read_text(encoding='utf-8-sig')),
                        json.loads(Path(arguments.verify).read_text(encoding='utf-8-sig')))
    else:
        result = generate_division_only(arguments.seed, arguments.random) if arguments.division_only else generate(arguments.seed, arguments.random)
    with Path(arguments.output).open('x', encoding='utf-8') as target:
        json.dump(result, target, indent=2, allow_nan=False)
    if result.get('status') == 'failed':
        raise SystemExit(1)
