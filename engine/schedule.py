"""Authoritative ca-v3 pass schedule, shared by every backend."""

from dataclasses import dataclass


MOVEMENT_SALT_COUNT = 4


@dataclass(frozen=True)
class KernelSpec:
    id: str
    name: str
    source_file: str
    constants: dict[str, int]


def _build_kernel_specs() -> tuple[KernelSpec, ...]:
    specs: list[KernelSpec] = [
        KernelSpec("structure", "Structural support and transport", "phase_2e_structure.wgsl", {}),
        KernelSpec("vertical0", "Vertical gravity phase 0", "phase_2b_winner.wgsl", {"GRAVITY_PHASE": 0}),
        KernelSpec("vertical1", "Vertical gravity phase 1", "phase_2b_winner.wgsl", {"GRAVITY_PHASE": 1}),
    ]

    for salt in range(MOVEMENT_SALT_COUNT):
        for phase in (0, 1):
            specs.append(KernelSpec(
                f"diagonal{phase}_s{salt}",
                f"Diagonal fall phase {phase} salt {salt}",
                "phase_2b_diagonal_winner.wgsl",
                {"MOVE_PHASE": phase, "MOVE_SALT": salt},
            ))

    for salt in range(MOVEMENT_SALT_COUNT):
        for phase in (0, 1):
            specs.append(KernelSpec(
                f"liquid{phase}_s{salt}",
                f"Liquid spread phase {phase} salt {salt}",
                "phase_2b_liquid_winner.wgsl",
                {"MOVE_PHASE": phase, "MOVE_SALT": salt},
            ))

    specs.extend([
        KernelSpec("gas_buoyancy0", "Gas buoyancy phase 0", "phase_2b_gas_buoyancy_winner.wgsl", {"MOVE_PHASE": 0}),
        KernelSpec("gas_buoyancy1", "Gas buoyancy phase 1", "phase_2b_gas_buoyancy_winner.wgsl", {"MOVE_PHASE": 1}),
    ])

    for salt in range(MOVEMENT_SALT_COUNT):
        for phase in (0, 1):
            specs.append(KernelSpec(
                f"gas_spread{phase}_s{salt}",
                f"Gas spread phase {phase} salt {salt}",
                "phase_2b_gas_spread_winner.wgsl",
                {"MOVE_PHASE": phase, "MOVE_SALT": salt},
            ))

    specs.extend([
        *[KernelSpec(f"thermal_{axis}{parity}", f"Thermal {axis} parity {parity}", "phase_2a_winner.wgsl",
                     {"THERMAL_AXIS": int(axis == "y"), "THERMAL_PARITY": parity})
          for axis in ("x", "y") for parity in (0, 1)],
        KernelSpec("phase", "Phase transitions", "phase_2c_winner.wgsl", {}),
        KernelSpec("combustion", "Combustion", "phase_2d_winner.wgsl", {}),
        KernelSpec("normalize", "Reciprocal bond normalization", "phase_2e_normalize.wgsl", {}),
    ])
    return tuple(specs)


KERNEL_SPECS = _build_kernel_specs()


def movement_schedule_for_tick(tick: int) -> list[str]:
    salt = int(tick) % MOVEMENT_SALT_COUNT
    return [
        "structure",
        "vertical0",
        "vertical1",
        f"diagonal0_s{salt}",
        f"diagonal1_s{salt}",
        f"liquid0_s{salt}",
        f"liquid1_s{salt}",
        "gas_buoyancy0",
        "gas_buoyancy1",
        f"gas_spread0_s{salt}",
        f"gas_spread1_s{salt}",
        "thermal_x0",
        "thermal_x1",
        "thermal_y0",
        "thermal_y1",
        "phase",
        "combustion",
        "normalize",
    ]

