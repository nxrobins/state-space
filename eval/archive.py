"""A bounded population whose parents require current immutable evaluation receipts."""

import math
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from eval.evaluator import accepted_receipt
from eval.policy import OBJECTIVES, EvaluationConfig, canonical, digest, target_name
from eval.provenance import read_json
from engine.catalog import unique_object


def pareto_rank(records: list[tuple[str, dict]], objectives=OBJECTIVES, higher_is_better=()) -> list[str]:
    if not objectives or len(set(objectives)) != len(objectives) or not set(higher_is_better) <= set(objectives):
        raise ValueError("Invalid objective configuration")
    def vector(fitness):
        values = []
        for key in objectives:
            value = fitness.get(key)
            if type(value) not in (int, float) or not math.isfinite(value):
                return None
            values.append(-value if key in higher_is_better else value)
        return tuple(values)
    remaining = {key: values for key, fitness in records if (values := vector(fitness)) is not None}
    ranked = []
    while remaining:
        front = [key for key, values in remaining.items() if not any(
            all(a <= b for a, b in zip(other, values)) and any(a < b for a, b in zip(other, values))
            for other_key, other in remaining.items() if other_key != key)]
        ranked.extend(sorted(front, key=lambda key: (remaining[key], key)))
        for key in front:
            del remaining[key]
    return ranked


@dataclass
class Candidate:
    id: str
    generation: int = 0
    parent_ids: list = field(default_factory=list)
    mutation_description: str = ""
    code_diff: str = ""
    fitness: dict | None = None  # Historical display only. Never used to rank or admit.
    phase: str = "codec"
    created_at: str = ""
    evolvable_code: dict = field(default_factory=dict)
    receipt: str | None = None

    @property
    def source(self):
        return self.evolvable_code.get("_full_shader", "\n\n".join(self.evolvable_code.values()))

    def is_evaluated(self):
        return self.receipt is not None

    def is_viable(self, directory=None, context=None, config=EvaluationConfig()):
        if self.receipt is None or directory is None or context is None:
            return False
        try:
            return accepted_receipt(Path(directory), self.receipt, self.source, self.phase, context, config) is not None
        except (TypeError, ValueError):
            return False


class Archive:
    def __init__(self, target="codec", *, directory=None, context=None, config=EvaluationConfig(), max_size=15):
        if type(max_size) is not int or max_size < 1:
            raise ValueError("Archive size must be positive")
        self.target = target_name(target)
        self.directory = Path(directory) if directory is not None else None
        self.context, self.config, self.max_size = context, config, max_size
        self.candidates: list[Candidate] = []

    def _ranked(self):
        reports = []
        for candidate in self.candidates:
            if self.directory is None or self.context is None or candidate.receipt is None:
                continue
            try:
                if target_name(candidate.phase) != self.target:
                    continue
                report = accepted_receipt(self.directory, candidate.receipt, candidate.source, self.target, self.context, self.config)
            except ValueError:
                continue
            if report is not None:
                reports.append((candidate.id, report["fitness"]))
        ranked = pareto_rank(reports)
        by_id = {candidate.id: candidate for candidate in self.candidates}
        return [by_id[key] for key in ranked]

    def add(self, candidate):
        # Content identity is stable across processes; a fresh receipt replaces an old score.
        candidate.id = digest(candidate.source)
        self.candidates = [item for item in self.candidates if item.id != candidate.id]
        self.candidates.append(candidate)
        ranked = self._ranked()
        ranked_ids = {item.id for item in ranked}
        unqualified = [item for item in self.candidates if item.id not in ranked_ids]
        self.candidates = (ranked + unqualified[-self.max_size:])[:self.max_size]

    def select_parents(self, n=3):
        if type(n) is not int or n < 1:
            raise ValueError("Parent count must be positive")
        return self._ranked()[:n]

    def get_diversity_score(self, top_n=10):
        parents = self.select_parents(top_n)
        return len({digest(item.source) for item in parents}) / len(parents) if parents else 0.0

    def save(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {"archiveVersion": 2, "target": self.target, "candidates": [asdict(item) for item in self.candidates]}
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(canonical(data))
        temporary.replace(path)

    @classmethod
    def load(cls, path, **kwargs):
        archive = cls(**kwargs)
        if not Path(path).exists():
            return archive
        raw = Path(path).read_text(encoding="utf-8")
        # The historical format emitted Infinity for failed trials. Import only
        # its source/genealogy, discarding non-finite metadata and ALL old scores.
        # Current archives and every admission artifact retain strict JSON parsing.
        data = (json.loads(raw, object_pairs_hook=unique_object, parse_constant=lambda _value: None)
                if raw.lstrip().startswith("[") else read_json(Path(path)))
        # Historical files are read without altering them; old fitness never creates a receipt.
        historical = isinstance(data, list)
        if not historical and (data.get("archiveVersion") != 2 or target_name(data.get("target")) != archive.target):
            raise ValueError("Incompatible archive")
        items = data if historical else data["candidates"]
        for item in items:
            values = {key: value for key, value in item.items() if key in Candidate.__dataclass_fields__}
            values["fitness"] = None  # Non-authoritative historical numbers are not re-exported.
            if historical:
                values["receipt"] = None
            candidate = Candidate(**values)
            candidate.id = digest(candidate.source)
            archive.candidates.append(candidate)
        return archive
