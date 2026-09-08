"""Private subprocess entry point; callers use eval.evaluator.evaluate_candidate."""

import sys
from pathlib import Path

from eval.evaluator import execute_candidate
from eval.policy import EvaluationConfig, canonical
from eval.provenance import read_json


def main():
    request = read_json(Path(sys.argv[1]))
    report, evidence = execute_candidate(request["source"], request["target"], EvaluationConfig(**request["config"]), request["context"])
    Path(sys.argv[2]).write_bytes(canonical({"report": report, "evidence": evidence}))


if __name__ == "__main__":
    main()
