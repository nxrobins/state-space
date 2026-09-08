"""Engine-specific structural checks. Run with python -m engine.lint."""

import ast
import re
from pathlib import Path

from engine.catalog import load_catalog
from engine.generate import ROOT, check_generated, constants
from engine.enthalpy import MAX_ENERGY_Q, NO_MATERIAL, THERMO_STRIDE
from eval.policy import TARGETS, candidate_lint
from engine.wgsl_fixer import strip_entry_points_and_bindings


def lint_python(source: str, label: str) -> list[str]:
    errors = []
    try:
        tree = ast.parse(source, filename=label)
    except SyntaxError as error:
        return [f"SS000 {label}:{error.lineno}: {error.msg}"]
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            seen = set()
            for key in node.keys:
                if isinstance(key, ast.Constant):
                    if key.value in seen:
                        errors.append(f"SS005 {label}:{key.lineno}: duplicate literal dictionary key")
                    seen.add(key.value)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Path":
            if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                if re.match(r"^[A-Za-z]:[/\\]", node.args[0].value):
                    errors.append(f"SS004 {label}:{node.lineno}: machine-specific runtime root")
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name.startswith(("validate_", "checked_", "pack_", "_encode_")):
                if any(isinstance(child, ast.Assert) for child in ast.walk(node)):
                    errors.append(f"SS006 {label}:{node.lineno}: input validation must survive python -O")
    return errors


def lint_consumer(source: str, label: str) -> list[str]:
    names = "MAT|PHASE|FLAG|MATERIAL_NAMES|MAT_NAMES|MAT_COLORS|MAT_PHASE|MAT_THERMAL|COLD_ROWS|COLD_STRIDE"
    if re.search(rf"\b(?:const|enum)\s+(?:{names})\s*(?::|=|\{{)", source):
        return [f"SS002 {label}: copied material definitions; import generated definitions"]
    if re.search(r"\bfunction\s+movementScheduleForTick\s*\(", source):
        return [f"SS010 {label}: copied tick schedule; import the generated schedule"]
    return []


def lint_runtime(source: str, label: str) -> list[str]:
    """Prevent reproduced installation and resource-ownership failures."""
    tree = ast.parse(source, filename=label)
    errors = []
    if re.search(r"\.parent\s*\.parent|[\"']locked[\"']", source):
        errors.append(f"SS017 {label}: runtime assets must resolve within the installed package")
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "engine.generate":
            errors.append(f"SS018 {label}: runtime must not import the development generator")
    if label.replace("\\", "/").endswith(("compositor.py", "structure_gpu.py")):
        parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("create_buffer", "create_buffer_with_data"):
                parent = parents.get(node)
                if not (isinstance(parent, ast.Call) and isinstance(parent.func, ast.Name) and parent.func.id == "keep"):
                    errors.append(f"SS019 {label}: each run buffer must register deterministic cleanup through keep")
        if "resources.callback(buffer.destroy)" not in source or "with ExitStack() as resources:" not in source:
            errors.append(f"SS019 {label}: run buffers require an ExitStack destruction scope")
        for function in (node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == "_compile_pipelines"):
            for node in ast.walk(function):
                if isinstance(node, ast.Assign):
                    for target in node.targets:
                        value = target.value if isinstance(target, ast.Subscript) else target
                        if (isinstance(value, ast.Attribute) and isinstance(value.value, ast.Name) and value.value.id == "self"
                                and value.attr in ("pipelines", "kernel_sources") and (isinstance(target, ast.Subscript) or isinstance(node.value, ast.Dict))):
                            errors.append(f"SS022 {label}: compile into local caches before replacing live pipelines")
    return errors


def lint_example_html(source: str) -> list[str]:
    if re.search(r'<script\b[^>]*\bsrc=["\'][^"\']+\.mjs["\']', source):
        return ["SS023 browser examples need .js entry files for portable static-server MIME types"]
    return []


def lint_evaluation(source: str, label: str) -> list[str]:
    """Narrow structural guards accompany the executable evaluation properties."""
    tree = ast.parse(source, filename=label)
    errors = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr == "fitness" and isinstance(node.value, ast.Name) and node.value.id in ("self", "candidate"):
            errors.append(f"SS026 {label}: candidate-owned fitness cannot authorize admission or ranking")
        if isinstance(node, ast.Call):
            name = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", "")
            if name == "fix_wgsl":
                errors.append(f"SS027 {label}: evaluate exact candidate text; repairs require a new candidate identity")
            if (isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "json" and name in ("dump", "dumps")):
                if not any(keyword.arg == "allow_nan" and isinstance(keyword.value, ast.Constant) and keyword.value.value is False for keyword in node.keywords):
                    errors.append(f"SS028 {label}: evidence serialization must reject non-finite numbers")
            if (isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "subprocess" and name == "run"):
                if not any(keyword.arg == "timeout" for keyword in node.keywords):
                    errors.append(f"SS030 {label}: evaluation subprocesses need an explicit deadline")
        if isinstance(node, ast.FunctionDef) and node.name == "synchronized_sample":
            calls = [child for child in ast.walk(node) if isinstance(child, ast.Call)]
            reads = sorted(child.lineno for child in calls if isinstance(child.func, ast.Attribute) and child.func.attr == "read_buffer")
            clocks = sorted(child.lineno for child in calls if isinstance(child.func, ast.Attribute) and child.func.attr == "perf_counter")
            dispatches = [child.lineno for child in calls if isinstance(child.func, ast.Name) and child.func.id == "dispatch"]
            if not (len(reads) == 2 and len(clocks) == 2 and len(dispatches) == 1
                    and reads[0] < clocks[0] < dispatches[0] < reads[1] < clocks[1]):
                errors.append(f"SS029 {label}: timing must drain prior work and include completion of the measured dispatch")
        if isinstance(node, ast.FunctionDef) and node.name == "accepted_receipt":
            if not any(isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and child.func.id == "validate_reference_evidence" for child in ast.walk(node)):
                errors.append(f"SS041 {label}: receipt admission must validate the contents of complete reference evidence")
    return errors


def lint_enthalpy(source: str, label: str) -> list[str]:
    """Keep reference arithmetic integer-only and separate from its view.

    Numeric range/conservation proofs require the executable property suite;
    these syntactic rules intentionally make narrower claims.
    """
    errors = []
    for node in ast.walk(ast.parse(source, filename=label)):
        is_float_call = isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "float"
        is_float_literal = isinstance(node, ast.Constant) and type(node.value) is float
        if (isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div)) or is_float_call or is_float_literal:
            errors.append(f"SS012 {label}:{node.lineno}: thermodynamic arithmetic must remain integer-only")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "temperature_byte":
            errors.append(f"SS013 {label}:{node.lineno}: clipped display temperature must not drive thermodynamic state")
    return errors


def lint_bulk_state(source: str, label: str) -> list[str]:
    errors = lint_enthalpy(source, label)
    for node in ast.walk(ast.parse(source, filename=label)):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name) and node.func.value.id == "np" and node.func.attr == "sum"):
            if not any(keyword.arg == "dtype" and isinstance(keyword.value, ast.Attribute)
                       and isinstance(keyword.value.value, ast.Name) and keyword.value.value.id == "np"
                       and keyword.value.attr == "int64" for keyword in node.keywords):
                errors.append(f"SS031 {label}: world energy reductions require explicit signed 64-bit accumulation")
        if (isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
                and node.value.id == "np" and node.attr in ("int32", "uint32", "uint64", "float32", "float64")):
            errors.append(f"SS032 {label}: bulk energy intermediates require signed 64-bit arithmetic")
    return errors


def lint_structure(source: str, label: str) -> list[str]:
    """Narrow syntax guards; independent conformance proves physical behavior."""
    arithmetic = label.endswith(("structure.py", "structure_bulk.py"))
    errors = lint_enthalpy(source, label) if arithmetic else []
    tree = ast.parse(source, filename=label)
    for node in ast.walk(tree):
        if (arithmetic and isinstance(node, ast.Assign)
                and any(isinstance(target, ast.Name) and target.id in ("loads", "capacities", "reactions") for target in node.targets)
                and isinstance(node.value, ast.Call)):
            if not any(keyword.arg == "dtype" and ast.unparse(keyword.value) == "np.int64" for keyword in node.value.keywords):
                errors.append(f"SS033 {label}: structural load/capacity arrays require signed 64-bit arithmetic")
        if (label.endswith("structure_bulk.py") and isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Subscript)
                and isinstance(node.target.value, ast.Name) and node.target.value.id == "loads"):
            errors.append(f"SS037 {label}: shared load destinations require an accumulating scatter reduction")
        if (label.endswith("structure.py") and isinstance(node, ast.FunctionDef) and node.name == "apply"):
            geometry = {argument.arg for argument in node.args.kwonlyargs}
            guards = [ast.unparse(child.test) for child in ast.walk(node) if isinstance(child, ast.If)]
            if not {"width", "height"} <= geometry or "(width, height) != (self.width, self.height)" not in guards:
                errors.append(f"SS034 {label}: plan application must check both dimensions, not only the cell count")
        if (label.endswith("structure_gpu.py") and isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name) and node.func.value.id == "plan" and node.func.attr == "apply"):
            if not {"width", "height"} <= {keyword.arg for keyword in node.keywords}:
                errors.append(f"SS034 {label}: GPU plan validation must include the dispatch geometry")
    return errors


def lint_scenario_identity(source: str, label: str) -> list[str]:
    errors = []
    for function in ast.walk(ast.parse(source, filename=label)):
        if not isinstance(function, ast.FunctionDef) or function.name not in ("fixture", "scene"):
            continue
        if not any(argument.arg == "name" for argument in function.args.args):
            continue
        for node in ast.walk(function):
            if isinstance(node, (ast.For, ast.comprehension)):
                if any(isinstance(target, ast.Name) and target.id == "name" for target in ast.walk(node.target)):
                    errors.append(f"SS036 {label}: scenario identity must not be overwritten by a loop variable")
    return errors


def lint_checkpoint_outputs(source: str, label: str) -> list[str]:
    errors = []
    for node in ast.walk(ast.parse(source, filename=label)):
        if not isinstance(node, ast.List):
            continue
        strings = {item.value for item in node.elts if isinstance(item, ast.Constant) and isinstance(item.value, str)}
        if (("eval.verify" in strings or "scripts.verify_browser" in strings) and "--output" not in strings) or ("scripts/verify_sdk.py" in strings and "--report" not in strings):
            errors.append(f"SS038 {label}: checkpoint subprocesses require explicit per-run evidence destinations")
    return errors


def lint_release_boundary(source: str, label: str) -> list[str]:
    errors = []
    for node in ast.walk(ast.parse(source, filename=label)):
        if label.endswith('verify_browser.py') and isinstance(node, ast.Call) and ast.unparse(node.func) == 'subprocess.run':
            for keyword in node.keywords:
                if ((keyword.arg == 'capture_output' and isinstance(keyword.value, ast.Constant) and keyword.value.value is True)
                        or (keyword.arg in ('stdout', 'stderr') and ast.unparse(keyword.value) == 'subprocess.PIPE')):
                    errors.append('SS044 browser daemon capture must not wait for inherited output pipes to close')
        if label.endswith('test_cascade.py') and isinstance(node, ast.If):
            expression = ast.unparse(node.test)
            if 'array_equal' in expression and 'final_energy' in expression and 'final_structure' not in expression:
                errors.append('SS045 deterministic replay must compare complete packed, energy and structural state')
    return errors


def lint_lab_css(source: str) -> list[str]:
    bodies = re.findall(r'(?:^|\})\s*canvas\s*\{([^}]+)\}', source)
    if any('object-fit:contain' in body.replace(' ', '') or re.search(r'(?:max-)?height:\s*\d+px', body) for body in bodies):
        return ['SS043 canvas picking requires an aspect-preserving content box without letterboxing']
    return []


def lint_wgsl(source: str, label: str, values: dict[str, int]) -> list[str]:
    errors = []
    source = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.S)
    if label.replace("\\", "/").endswith("structure_apply.wgsl"):
        writes = re.findall(r"\b(packed_out|energy_out|structure_out)\s*\[([^]]+)\]\s*=\s*([^;]+);", source)
        expected = [("packed_out", "index", "packed_in[source]"), ("energy_out", "index", "energy_in[source]"),
                    ("structure_out", "index", "structural_plan[index].y")]
        def compact(value):
            return re.sub(r"\s+", "", value)
        if [(name, compact(index), compact(value)) for name, index, value in writes] != expected:
            errors.append(f"SS035 {label}: structural transport must move packed/energy together and apply planned damage")
    if re.search(r"phase_2[abcd]", label) and re.search(r"\b(?:grid_out|energy_out)\s*\[[^]]+\]\s*=", source):
        errors.append(f"SS014 {label}: physics kernels must write packed and energy state through io_copy/io_write")
    if label.replace("\\", "/").endswith("state_io.wgsl"):
        body = re.search(r"fn\s+io_copy\([^)]*\)\s*\{([^}]+)\}", source)
        expected = r"\s*grid_out\[destination\]\s*=\s*grid_in\[source\];\s*energy_out\[destination\]\s*=\s*energy_in\[source\];\s*structure_out\[destination\]\s*=\s*structure_in\[source\];\s*"
        if body is None or re.fullmatch(expected, body.group(1)) is None:
            errors.append(f"SS015 {label}: io_copy must transport all three arrays from the same source cell")
        transport = re.search(r"fn\s+io_apply_structure\([^)]*\)\s*\{([^}]+)\}", source)
        required = ("let source = structural_plan[index].x;", "grid_out[index] = grid_in[source];",
                    "energy_out[index] = energy_in[source];", "structure_out[index] = structural_plan[index].y;")
        if transport is None or any(re.sub(r"\s+", "", statement) not in re.sub(r"\s+", "", transport.group(1)) for statement in required):
            errors.append(f"SS035 {label}: structural transport must move packed/energy together and apply planned damage")
        falling = re.search(r"fn\s+io_can_fall\([^)]*\)\s*->\s*bool\s*\{([^}]+)\}", source)
        if falling is None or any(f"!io_bound({index})" not in re.sub(r"\s+", "", falling.group(1)) for index in ("source", "destination")):
            errors.append(f"SS040 {label}: independent movement must protect both source and destination structures and pins")
    values = {**values, "COLD_STRIDE": values["COLD_TABLE_STRIDE"],
              "MAX_ENERGY_Q": MAX_ENERGY_Q, "NO_MATERIAL": NO_MATERIAL, "THERMO_STRIDE": THERMO_STRIDE}
    for name, value in re.findall(r"\bconst\s+(\w+)\s*:\s*u32\s*=\s*(0x[0-9a-fA-F]+|[0-9]+)u?\s*;", source):
        if name in values and int(value, 0) != values[name]:
            errors.append(f"SS003 {label}: {name} disagrees with the catalog")
        if name in ("GRID_WIDTH", "GRID_HEIGHT"):
            errors.append(f"SS003 {label}: grid dimensions must be override constants")
    # Track explicit lower-bound guards for subtractive local u32 array indices.
    # A multiply by zero or WGSL select evaluates its arguments and is not a guard.
    tokens = re.finditer(r"if\s*\(([^()]*)\)\s*\{|[{}]|\b\w+\[\s*(\w+)\s*-\s*(\d+)u\s*\]", source)
    storage_arrays = set(re.findall(r"\bvar\s*<\s*storage\b[^>]*>\s*(\w+)\s*:", source))
    guards = []
    for token in tokens:
        if token.group(1) is not None:
            guards.append(token.group(1).strip())
        elif token.group() == "{":
            guards.append("")
        elif token.group() == "}":
            if guards:
                guards.pop()
        elif token.group(2) is not None:
            if token.group().split("[", 1)[0] in storage_arrays:
                continue  # Spatial storage accesses are checked by scenario/dimension properties.
            variable, offset = token.group(2), int(token.group(3))
            safe = False
            for condition in guards:
                match = re.fullmatch(rf"{re.escape(variable)}\s*(>=|>)\s*(\d+)u", condition)
                if match and int(match.group(2)) + int(match.group(1) == ">") >= offset:
                    safe = True
            if not safe:
                errors.append(f"SS011 {label}: unsigned subtractive array index lacks an explicit lower-bound guard")
    return errors


def lint(root: Path = ROOT) -> list[str]:
    errors = []
    try:
        values = constants(load_catalog(root / "engine/materials.json"))
        errors.extend(f"SS001 {path}: generated asset drift" for path in check_generated(root))
    except (ValueError, TypeError, KeyError, OSError) as error:
        return [f"SS007 invalid catalog or missing source: {error}"]
    for path in [*(root / "engine").glob("*.py"), *(root / "eval").glob("*.py"), root / "evolve_ss.py"]:
        errors.extend(lint_python(path.read_text(encoding="utf-8"), str(path.relative_to(root))))
        if path.name == "enthalpy.py":
            errors.extend(lint_enthalpy(path.read_text(encoding="utf-8"), str(path.relative_to(root))))
        if path.name == "array_state.py":
            errors.extend(lint_bulk_state(path.read_text(encoding="utf-8"), str(path.relative_to(root))))
        if path.name in ("structure.py", "structure_gpu.py", "structure_bulk.py"):
            errors.extend(lint_structure(path.read_text(encoding="utf-8"), path.name))
        if "conformance" in path.name or path.name == "scenes.py":
            errors.extend(lint_scenario_identity(path.read_text(encoding="utf-8"), path.name))
        if path.name == "verify.py" and path.parent.name == "engine":
            errors.extend(lint_checkpoint_outputs(path.read_text(encoding="utf-8"), path.name))
        if path.name in ("compositor.py", "structure_gpu.py", "contracts.py", "registry.py", "field.py", "resources.py", "__init__.py"):
            errors.extend(lint_runtime(path.read_text(encoding="utf-8"), str(path.relative_to(root))))
        if path.parent.name == "eval" or path.name == "evolve_ss.py":
            errors.extend(lint_evaluation(path.read_text(encoding="utf-8"), str(path.relative_to(root))))
    for path in (root / "engine/browser_state_space.ts", root / "web/app.js", *(root / "examples/lab").glob('*.js')):
        errors.extend(lint_consumer(path.read_text(encoding="utf-8"), str(path.relative_to(root))))
    for path in [*(root / "locked").glob("*.wgsl"), *(root / "engine/shaders").glob("*.wgsl")]:
        errors.extend(lint_wgsl(path.read_text(encoding="utf-8"), str(path.relative_to(root)), values))
    for path in (root / "examples").rglob("*.html"):
        errors.extend(lint_example_html(path.read_text(encoding="utf-8")))
    for path in (root / 'scripts/verify_browser.py', root / 'test_cascade.py'):
        if path.is_file():
            errors.extend(lint_release_boundary(path.read_text(encoding='utf-8'), path.name))
    css = root / 'examples/lab/style.css'
    if css.is_file():
        errors.extend(lint_lab_css(css.read_text(encoding='utf-8')))
    for target, name in TARGETS.items():
        source = (root / "locked" / name).read_text(encoding="utf-8")
        errors.extend(candidate_lint(strip_entry_points_and_bindings(source) if target == "codec" else source, target))
    return errors


def main() -> int:
    errors = lint()
    for error in errors:
        print(error)
    if not errors:
        print("Engine structural lint passed")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
