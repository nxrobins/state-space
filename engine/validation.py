"""Numeric contract validation shared by runtimes and catalogs."""

from numbers import Integral
import numpy as np

MAX_CELLS = 0x3fffffff
MAX_TICK = 2**53 - 1  # JavaScript's largest exactly representable integer.


def checked_integer(value, minimum: int, maximum: int, name: str) -> int:
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, Integral) or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer in [{minimum}, {maximum}]")
    return int(value)


def validate_dimensions(width: int, height: int) -> tuple[int, int]:
    width = checked_integer(width, 1, MAX_CELLS, "width")
    height = checked_integer(height, 1, MAX_CELLS, "height")
    if width * height > MAX_CELLS:
        raise ValueError("Grid exceeds the packed buffer address range")
    return width, height


def validate_packed(values, length: int, name: str = "packedCells") -> np.ndarray:
    if not isinstance(values, np.ndarray):
        try:
            if any(isinstance(value, (bool, np.bool_)) or not isinstance(value, Integral) for value in values):
                raise ValueError(f"{name} must contain integer values without coercion")
        except TypeError as error:
            raise ValueError(f"{name} must be an array of integer values") from error
    array = np.asarray(values)
    if array.ndim != 1 or array.size != length:
        raise ValueError(f"{name} must contain exactly {length} row-major cells")
    if array.dtype.kind not in "ui" or np.any(array < 0) or np.any(array > 0xffffffff):
        raise ValueError(f"{name} must contain unsigned 32-bit integer values")
    return np.array(array, dtype=np.uint32, copy=True)


