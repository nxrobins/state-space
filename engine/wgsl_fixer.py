"""
WGSL validation pre-pass: auto-fix common type errors before GPU compilation.

The LLM frequently generates WGSL with:
1. Mixed i32/u32 in bitwise operations
2. Missing 'u' suffix on integer literals in u32 context
3. Incorrect select() argument order
4. Redefined structs/constants that are already in bitmask_defs.wgsl
5. GLSL-isms (int instead of i32, uint instead of u32, etc.)
"""

import re


def fix_wgsl(source: str) -> str:
    """Apply common WGSL fixes. Returns corrected source."""
    s = source

    # Fix 1: Remove redefinitions of things already in bitmask_defs.wgsl
    # These get prepended automatically — duplicates cause compilation errors
    s = _remove_redefinitions(s)

    # Fix 2: GLSL-isms → WGSL types
    s = _fix_glsl_types(s)

    # Fix 3: Add 'u' suffix to bare integer literals in u32 context
    s = _fix_unsigned_literals(s)

    # Fix 4: Fix common shift amount issues (must be u32)
    s = _fix_shift_amounts(s)

    # Fix 5: Fix bitwise NOT syntax
    s = _fix_bitwise_not(s)

    return s


def _remove_redefinitions(s: str) -> str:
    """Remove struct/const definitions that are already in bitmask_defs.wgsl."""
    # Remove VoxelState struct redefinition
    s = re.sub(r'struct\s+VoxelState\s*\{[^}]*\}\s*;?\s*\n?', '', s)

    # Remove const redefinitions for known constants
    known_consts = [
        'MATERIAL_SHIFT', 'MATERIAL_MASK', 'THERMAL_SHIFT', 'THERMAL_MASK',
        'KINETIC_X_SHIFT', 'KINETIC_X_MASK', 'KINETIC_Y_SHIFT', 'KINETIC_Y_MASK',
        'PHASE_SHIFT', 'PHASE_MASK', 'FLAGS_SHIFT', 'FLAGS_MASK',
        'MAT_AIR', 'MAT_STONE', 'MAT_WATER', 'MAT_SAND', 'MAT_FIRE',
        'MAT_METAL', 'MAT_OIL', 'MAT_WOOD', 'MAT_ICE', 'MAT_STEAM',
        'MAT_LAVA', 'MAT_GLASS', 'MAT_PLAYER',
        'PHASE_SOLID', 'PHASE_POWDER', 'PHASE_LIQUID', 'PHASE_VISCOUS',
        'PHASE_GAS', 'PHASE_PLASMA', 'PHASE_FROZEN', 'PHASE_MOLTEN',
        'PHASE_BURNING', 'PHASE_CONDENSING', 'PHASE_EVAPORATING', 'PHASE_SUBLIMATING',
        'FLAG_BURNING', 'FLAG_CONDUCTING', 'FLAG_PRESSURIZED', 'FLAG_PLAYER_OWNED',
        'GRID_WIDTH', 'GRID_HEIGHT',
    ]
    for const in known_consts:
        # Match: const NAME: type = value;
        s = re.sub(rf'const\s+{const}\s*:\s*[^;]+;\s*\n?', '', s)

    return s


def _fix_glsl_types(s: str) -> str:
    """Replace GLSL type names with WGSL equivalents."""
    # Only replace standalone type keywords, not inside identifiers
    replacements = [
        (r'\bint\b', 'i32'),
        (r'\buint\b', 'u32'),
        (r'\bfloat\b', 'f32'),
        (r'\bivec2\b', 'vec2<i32>'),
        (r'\buvec2\b', 'vec2<u32>'),
        (r'\bivec3\b', 'vec3<i32>'),
        (r'\buvec3\b', 'vec3<u32>'),
        (r'\bivec4\b', 'vec4<i32>'),
        (r'\buvec4\b', 'vec4<u32>'),
    ]
    for pattern, replacement in replacements:
        s = re.sub(pattern, replacement, s)
    return s


def _fix_unsigned_literals(s: str) -> str:
    """Add 'u' suffix to bare integer literals used with u32 operations."""
    # Fix: >> N  →  >> Nu  (shift amounts must be u32)
    s = re.sub(r'(>>|<<)\s*(\d+)(?!u|\.\d)', r'\1 \2u', s)

    # Fix: & 0xFF → & 0xFFu (hex literals in bitwise ops)
    # Must check the literal isn't already suffixed with 'u'
    s = re.sub(r'([&|^])\s*(0x[0-9A-Fa-f]+)(?![0-9A-Fa-fu])', r'\1 \2u', s)

    return s


def _fix_shift_amounts(s: str) -> str:
    """Ensure shift amounts are u32."""
    # Already handled by _fix_unsigned_literals for literals
    # Also fix: >> i32_var  (common error)
    # This is harder to fix automatically — would need type inference
    return s


def _fix_bitwise_not(s: str) -> str:
    """Fix ~ operator usage — ensure it's applied to u32, not mixed types."""
    # WGSL uses ~ for bitwise NOT, same as most languages
    # Common issue: ~(MASK << SHIFT) where MASK/SHIFT are already u32 — this is fine
    return s


def strip_entry_points_and_bindings(source: str) -> str:
    """
    Strip @compute entry points, @group/@binding declarations, and
    global storage buffer declarations from locked WGSL code.
    Used when prepending locked functions to a new shader that has its own entry point.
    """
    lines = source.split('\n')
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Skip @group/@binding var declarations
        if stripped.startswith('@group(') and ('var<storage' in stripped or 'var<uniform' in stripped):
            i += 1
            continue

        # Skip @compute entry point + its entire function body
        if '@compute' in stripped:
            # Skip until matching closing brace
            depth = 0
            found_open = False
            while i < len(lines):
                depth += lines[i].count('{') - lines[i].count('}')
                if '{' in lines[i]:
                    found_open = True
                i += 1
                if found_open and depth <= 0:
                    break
            continue

        # Skip standalone var<workgroup> declarations (may conflict)
        if stripped.startswith('var<workgroup>'):
            i += 1
            continue

        result.append(line)
        i += 1

    return '\n'.join(result)


def validate_wgsl_basic(source: str) -> list[str]:
    """
    Basic static validation of WGSL source. Returns list of warnings.
    Not a full parser — catches common issues cheaply.
    """
    warnings = []

    # Check for GLSL-isms
    if re.search(r'\bgl_GlobalInvocationID\b', source):
        warnings.append("GLSL builtin gl_GlobalInvocationID used — use @builtin(global_invocation_id)")

    if re.search(r'\blayout\s*\(', source):
        warnings.append("GLSL layout() syntax used — use @group/@binding")

    if re.search(r'#version\s+\d+', source):
        warnings.append("GLSL #version directive found")

    if re.search(r'\bvoid\s+main\s*\(', source):
        warnings.append("GLSL-style void main() found — use fn main() with @compute attribute")

    # Check for missing entry point
    if '@compute' not in source:
        warnings.append("No @compute entry point found")

    # Check for duplicate binding declarations
    bindings = re.findall(r'@binding\((\d+)\)', source)
    if len(bindings) != len(set(bindings)):
        warnings.append("Duplicate @binding indices detected")

    return warnings


if __name__ == "__main__":
    # Test with a sample that has common errors
    test_code = """
struct VoxelState {
    material: u32,
    thermal: u32,
    kinetic_x: i32,
    kinetic_y: i32,
    phase: u32,
    flags: u32,
}

const MATERIAL_MASK: u32 = 0xFFu;
const THERMAL_SHIFT: u32 = 8u;

fn test(x: u32) -> u32 {
    let a = x >> 8;
    let b = x & 0xFF;
    return a | b;
}
"""
    fixed = fix_wgsl(test_code)
    print("=== Fixed ===")
    print(fixed)
    warnings = validate_wgsl_basic(fixed)
    if warnings:
        print("\nWarnings:")
        for w in warnings:
            print(f"  - {w}")
