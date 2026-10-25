"""Compiler API consumers and evidence identity, without native adapter discovery."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from eval.evaluator import reference_outputs, validate_reference_evidence
from eval.provenance import capture_context
from eval.scenes import cell, prepared


class CompilerTools(unittest.TestCase):
    def test_reference_compiles_and_returns_complete_cpu_passes(self):
        scene = prepared({"name": "compiler-check", "width": 1, "height": 1,
                          "tick": 0, "ticks": 1, "cells": [cell(7)]})
        reference = reference_outputs([scene])[0]
        cells, energy, structure = validate_reference_evidence(scene, reference)
        self.assertEqual(cells.tolist(), scene["cells"])
        self.assertEqual(energy.tolist(), scene["energyQ"])
        self.assertEqual(structure.tolist(), scene["structure"])

    def test_provenance_tracks_both_compiler_shim_and_implementation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shim = root / "node_modules/@typescript/typescript6/index.js"
            implementation = shim.parent / "node_modules/@typescript/old/index.js"
            for path in (shim, implementation):
                path.parent.mkdir(parents=True)
            shim.write_text("module.exports = require('@typescript/old');")
            implementation.write_text("module.exports = {version: '6.fixture'};")
            with patch("eval.provenance.ROOT", root), \
                 patch("eval.provenance.context_sources", return_value={}), \
                 patch("eval.provenance.device_identity", return_value={}):
                previous = capture_context()["runtime"]
                self.assertEqual(previous["typescript"], "6.fixture")
                self.assertEqual(previous["typescriptHash"], capture_context()["runtime"]["typescriptHash"])
                for path in (implementation, shim):
                    path.write_text(path.read_text() + "\n// modified compiler bytes\n")
                    current = capture_context()["runtime"]
                    self.assertEqual(current["typescript"], previous["typescript"])
                    self.assertNotEqual(current["typescriptHash"], previous["typescriptHash"])
                    previous = current
