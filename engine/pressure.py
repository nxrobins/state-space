"""Independent integer cellular pressure law. See docs/PRESSURE.md.

Pressure occupies the high half of the mechanical word. Connectivity is global;
relaxation is temporal, never a truncated flood fill. No energy coordinate changes.
"""
import numpy as np

from engine.array_state import temperature_q_array

PRESSURE_MASK = 0xffff0000
MOVED = 0x4000
LIQUID_PHASES = (2, 3, 7)
GAS_PHASES = (4, 5)


def fluid_kind(packed):
    phase = (int(packed) >> 24) & 15
    return 1 if phase in GAS_PHASES else 2 if phase in LIQUID_PHASES else 0


def update_pressure(cells, energy, words, width, height, rules):
    from engine.structure import neighbors
    kinds = [fluid_kind(cell) for cell in cells]
    temperatures = temperature_q_array(cells & 255, energy, rules.thermal)
    seen = bytearray(len(cells))
    output = words.copy()

    def relax(index, target):
        old = int(words[index]) >> 16
        difference = min(65535, target) - old
        value = old + (1 if difference >= 0 else -1) * ((abs(difference) + 3) // 4)
        output[index] = value << 16

    # Gas first: liquid surface loading reads this tick's relaxed gas pressure.
    for kind in (1, 2):
        for root in range(len(cells)):
            if kinds[root] != kind or seen[root]:
                continue
            members = [root]
            seen[root] = 1
            for index in members:
                for j in neighbors(index, width, height):
                    if j >= 0 and kinds[j] == kind and not seen[j]:
                        seen[j] = 1
                        members.append(j)
            if kind == 1:
                absolute = sum(min(66559, (int(temperatures[i]) // 256 + 64) * 1024 // 84) for i in members)
                target = max(0, absolute // len(members) - 1024)
                for i in members:
                    relax(i, target)
            else:
                top = min(i // width for i in members)
                head = max((int(output[j]) >> 16 for i in members for j in neighbors(i, width, height)
                            if j >= 0 and kinds[j] == 1), default=0)
                for i in members:
                    weight = max(1, (rules.materials[int(cells[i]) & 255].density + 63) // 64)
                    relax(i, head + (i // width - top + 1) * weight * 16)
    return output


def pressure_loads(words, width, height):
    """Net opposing-face traction, separate from the gravity reaction ledger."""
    p = (np.asarray(words, dtype=np.int64) >> 16).reshape(height, width)
    padded = np.pad(p, 1)
    return (np.abs(padded[1:-1, :-2] - padded[1:-1, 2:])
            + np.abs(padded[:-2, 1:-1] - padded[2:, 1:-1])).reshape(-1)
