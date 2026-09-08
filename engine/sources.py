"""Immutable runtime shader inputs, also used by offline candidate evaluation."""

from dataclasses import dataclass

from engine.resources import kernel_source, shader_source
from engine.schedule import KERNEL_SPECS


KERNEL_FILES = tuple(sorted({"phase_1a_winner.wgsl", *(spec.source_file for spec in KERNEL_SPECS)}))
SHADER_FILES = ("bitmask_defs.wgsl", "state_io.wgsl", "enthalpy_law.wgsl")


@dataclass(frozen=True)
class ShaderBundle:
    kernels: tuple[tuple[str, str], ...]
    shaders: tuple[tuple[str, str], ...]

    def __post_init__(self):
        for entries, names in ((self.kernels, KERNEL_FILES), (self.shaders, SHADER_FILES)):
            if (type(entries) is not tuple or len(entries) != len(names)
                    or any(type(pair) is not tuple or len(pair) != 2 or any(type(v) is not str or not v for v in pair)
                           for pair in entries)
                    or sorted(name for name, _ in entries) != sorted(names)):
                raise ValueError("Shader bundle requires every named source exactly once as immutable strings")

    @classmethod
    def load(cls):
        return cls(tuple((name, kernel_source(name)) for name in KERNEL_FILES),
                   tuple((name, shader_source(name)) for name in SHADER_FILES))

    def kernel(self, name: str) -> str:
        return dict(self.kernels)[name]

    def shader(self, name: str) -> str:
        return dict(self.shaders)[name]

    def replace_kernel(self, name: str, source: str):
        if name not in KERNEL_FILES:
            raise ValueError(f"Unknown production kernel: {name}")
        return ShaderBundle(tuple((key, source if key == name else value) for key, value in self.kernels), self.shaders)
