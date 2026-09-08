"""Load runtime assets from the installed package, independent of the cwd."""

from importlib.resources import files


def shader_source(name: str) -> str:
    return files("engine").joinpath("shaders", name).read_text(encoding="utf-8")


def kernel_source(name: str) -> str:
    return files("engine").joinpath("kernels", name).read_text(encoding="utf-8")
