"""Static/refusal tests only: no physics, browser, GPU, or real OS Job execution."""
from contextlib import ExitStack
import json
from pathlib import Path
import struct
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from scripts import collision_cpu_scope as scope
from scripts import verify_collision_cpu as runner
from scripts.collision_cpu_leaf import NoGraphics, deny_external, platform_metadata
from scripts.verification_guard import assert_runtime_not_blocked


class ScopeTests(unittest.TestCase):
    def test_fixed_commands_and_sanitized_environment(self):
        self.assertNotIn('unit', scope.CASES)
        self.assertEqual(scope.CASES[:4], ('startup-close', 'stalled-cpu', 'supervisor-loss', 'world-reference'))
        for role in ('gpu', 'browser', 'arbitrary'):
            with self.assertRaises(RuntimeError):
                scope.command(Path('anything'), role)
        with patch.dict(runner.os.environ, {'NODE_OPTIONS': '--require unsafe', 'PYTHONPATH': 'unsafe',
                                           'STATE_SPACE_VERIFICATION_JOB': 'forged', 'MUJOCO_GL': 'glfw'}):
            env = runner.clean_environment()
        self.assertNotIn('NODE_OPTIONS', env)
        self.assertNotIn('PYTHONPATH', env)
        self.assertNotIn('STATE_SPACE_VERIFICATION_JOB', env)
        self.assertEqual(env['MUJOCO_GL'], 'disable')
        self.assertEqual(env['OMP_NUM_THREADS'], '1')
        self.assertEqual(env['ComSpec'], scope.WINDOWS_COMMAND)

    def test_hard_hold_still_blocks_generic_entry_even_with_forged_job(self):
        before = scope.hold_identity()
        with patch.dict(scope.os.environ, {'STATE_SPACE_VERIFICATION_JOB': 'forged',
                                          'STATE_SPACE_VERIFICATION_KIND': 'cpu'}):
            with self.assertRaises(RuntimeError):
                assert_runtime_not_blocked()
        self.assertEqual(before, scope.hold_identity())

    def test_no_graphics_or_external_operations(self):
        finder = NoGraphics()
        for name in ('glfw', 'OpenGL.GL', 'mujoco._render', 'mujoco.viewer', 'mujoco.rendering.classic'):
            with self.assertRaises(ImportError):
                finder.find_spec(name)
        self.assertIsNone(finder.find_spec('numpy'))
        for event in ('socket.gethostname', 'socket.__new__', 'socket.connect', 'socket.bind', 'socket.sendto',
                      'socket.getaddrinfo', 'socket.gethostbyname',
                      'subprocess.Popen', 'os.system', 'os.startfile'):
            with self.assertRaisesRegex(RuntimeError, event):
                deny_external(event, ())
        deny_external('open', ())

    def test_metadata_requires_the_pinned_command_before_reading_os_identity(self):
        with patch.dict(scope.os.environ, {'ComSpec': 'unreviewed.exe'}), \
                patch('scripts.collision_cpu_leaf.platform.uname') as query:
            with self.assertRaises(RuntimeError):
                platform_metadata()
            query.assert_not_called()
        info = Mock(system='Windows', release='11', version='test', machine='AMD64')
        with patch.dict(scope.os.environ, {'ComSpec': scope.WINDOWS_COMMAND}), \
                patch('scripts.collision_cpu_leaf.platform.uname', return_value=info) as query:
            self.assertEqual(platform_metadata()['system'], 'Windows')
            query.assert_called_once()

    def test_fixture_order_catches_comparator_import_before_the_remaining_scenes(self):
        self.assertEqual(scope.CASES[4:8], ('ss-free-drift', 'mj-free-drift', 'ss-thin-wall', 'mj-thin-wall'))

    def test_cannot_skip_prerequisites_or_reuse_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory)
            (packet / 'review.json').write_text('{}')
            with self.assertRaises(FileNotFoundError):
                runner.require_sequence(packet, 'world-reference')
            (packet / 'startup-close').mkdir()
            with self.assertRaises(RuntimeError):
                runner.require_sequence(packet, 'startup-close')

    def test_capability_rejects_mutations_expiry_unspent_and_wrong_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory) / ('a' * 32)
            attempt = packet / 'startup-close'
            attempt.mkdir(parents=True)
            (packet / 'review.json').write_text('{}')
            cap = {'version': 1, 'runId': 'b' * 32, 'case': attempt.name, 'mode': 'cpu-only',
                   'limits': scope.LIMITS, 'reviewSha256': scope.sha(packet / 'review.json'),
                   'command': scope.command(attempt, 'leaf'),
                   'supervisorCommand': scope.command(attempt, 'supervise'),
                   'ownerPid': 123, 'issuedAt': 100, 'expiresAt': 160}
            def write(value, claim=True, lock_case='startup-close'):
                (attempt / 'capability.json').write_text(json.dumps(value))
                (attempt / 'claim.json').write_text(json.dumps({
                    'capabilitySha256': scope.sha(attempt / 'capability.json') if claim else 'bad',
                    'ownerPid': value['ownerPid']}))
                (packet / 'execution.lock').write_text(json.dumps({
                    'ownerPid': 123, 'case': lock_case, 'reviewSha256': cap['reviewSha256']}))
            with patch.object(scope, 'BASE', Path(directory)), patch.object(scope, 'validate_review'):
                write(cap)
                self.assertEqual(scope.validate_capability(attempt, now=101)[0], cap)
                for key, value in (('command', ['chrome.exe']), ('mode', 'gpu-enabled'),
                                   ('limits', {**scope.LIMITS, 'cpuPercent': 99}),
                                   ('case', 'mj-free-drift'), ('expiresAt', 161),
                                   ('ownerPid', -1), ('runId', 'bad'), ('issuedAt', float('nan'))):
                    write({**cap, key: value})
                    with self.subTest(key=key), self.assertRaises(RuntimeError):
                        scope.validate_capability(attempt, now=101)
                write(cap)
                with self.assertRaises(RuntimeError):
                    scope.validate_capability(attempt, now=160)
                write(cap, claim=False)
                with self.assertRaises(RuntimeError):
                    scope.validate_capability(attempt, now=101)
                write(cap, lock_case='world-reference')
                with self.assertRaises(RuntimeError):
                    scope.validate_capability(attempt, now=101)

    def test_leaf_requires_real_job_membership_and_single_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            attempt = Path(directory)
            cap = {'runId': 'b' * 32}
            (attempt / 'capability.json').write_text('{}')
            (attempt / 'supervisor.json').write_text(json.dumps({
                'pid': scope.os.getppid(), 'runId': cap['runId'],
                'capabilitySha256': scope.sha(attempt / 'capability.json')}))
            (attempt / 'child.json').write_text(json.dumps({'pid': scope.os.getpid()}))
            job = Mock()
            with patch.object(scope, 'attempt_path', return_value=attempt), \
                    patch.object(scope, 'validate_capability', return_value=(cap, {})), \
                    patch.object(scope, 'JobObserver', return_value=job):
                job.require_membership.side_effect = RuntimeError('outside owned Job')
                with self.assertRaises(RuntimeError):
                    scope.claim_leaf(attempt)
                self.assertFalse((attempt / 'leaf-claim.json').exists())
                job.require_membership.side_effect = None
                scope.claim_leaf(attempt)
                with self.assertRaises(FileExistsError):
                    scope.claim_leaf(attempt)
                self.assertEqual(job.close.call_count, 3)

    def test_source_drift_cannot_validate_review(self):
        with self.assertRaises((RuntimeError, KeyError)):
            scope.validate_review({'schema': 'collision-cpu-review-v1', 'mode': 'gpu-enabled'})


class ProfileScopeTests(unittest.TestCase):
    def test_profile_keeps_all_containment_and_world_prerequisites_and_excludes_mujoco(self):
        review = {'profile': dict(scope.PROFILE_CONFIG)}
        self.assertEqual(scope.cases_for(review), scope.CASES[:4] + tuple('ss-' + s for s in scope.SCENES))
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory)
            (packet / 'review.json').write_text(json.dumps(review))
            with self.assertRaises(FileNotFoundError):
                runner.require_sequence(packet, 'ss-free-drift')
            with self.assertRaisesRegex(RuntimeError, 'outside'):
                runner.require_sequence(packet, 'mj-free-drift')
            cmd = scope.node_command(packet / 'ss-free-drift')
            self.assertTrue(cmd[2].endswith('profile-runner.mjs'))
            self.assertNotIn('--inspect', ' '.join(cmd))
            self.assertNotIn('--cpu-prof', ' '.join(cmd))

    def test_profile_cannot_change_interval_output_budget_baseline_or_recipe(self):
        for key, value in (('samplingIntervalMicros', 100), ('maxProfileBytes', 2**30),
                           ('baseline', 'other.json'), ('kind', 'arbitrary')):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                scope.cases_for({'profile': {**scope.PROFILE_CONFIG, key: value}})

    def test_profile_cannot_change_measured_engine_protocol_or_fixtures(self):
        baseline = scope.read_json(scope.ROOT / scope.PROFILE_CONFIG['baselinePacket'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'packet.json'
            identity = {'directory': directory, 'bundleSha256': scope.PROFILE_CONFIG['bundleSha256']}
            path.write_text(json.dumps(baseline))
            self.assertEqual(scope.profile_identity(identity), scope.PROFILE_CONFIG)
            with self.assertRaises(RuntimeError):
                scope.profile_identity({**identity, 'bundleSha256': 'changed'})
            baseline['protocol']['samples'] = 1
            path.write_text(json.dumps(baseline))
            with self.assertRaises(RuntimeError):
                scope.profile_identity(identity)


class OptimizationScopeTests(unittest.TestCase):
    def test_optimization_requires_regression_and_world_before_the_original_cohort(self):
        review = {'optimization': dict(scope.OPTIMIZATION_CONFIG)}
        self.assertEqual(scope.cases_for(review), scope.CASES[:3] + ('ss-owned-regression',) + scope.CASES[3:])
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory)
            (packet / 'review.json').write_text(json.dumps(review))
            with self.assertRaises(FileNotFoundError):
                runner.require_sequence(packet, 'world-reference')
            self.assertTrue(scope.node_command(packet / 'ss-owned-regression')[2].endswith('optimized-runner.mjs'))
            (packet / 'review.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'outside'):
                runner.require_sequence(packet, 'ss-owned-regression')

    def test_optimization_recipe_rejects_mixed_modes_or_changed_controls(self):
        with self.assertRaises(RuntimeError):
            scope.cases_for({'optimization': scope.OPTIMIZATION_CONFIG, 'profile': scope.PROFILE_CONFIG})
        for key, value in (('freshBaselineControls', False), ('baselineBundle', 'other.mjs'), ('kind', 'arbitrary')):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                scope.cases_for({'optimization': {**scope.OPTIMIZATION_CONFIG, key: value}})

    def test_optimization_only_allows_rigid_source_drift_and_unchanged_protocol(self):
        baseline = scope.read_json(scope.ROOT / scope.OPTIMIZATION_CONFIG['baselinePacket'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'packet.json'
            changed = json.loads(json.dumps(baseline))
            next(r for r in changed['files'] if r['path'].endswith('/rigid.ts'))['sha256'] = 'new-rigid'
            path.write_text(json.dumps(changed))
            self.assertEqual(scope.optimization_identity({'directory': directory}), scope.OPTIMIZATION_CONFIG)
            next(r for r in changed['files'] if r['path'].endswith('/collision.ts'))['sha256'] = 'changed'
            path.write_text(json.dumps(changed))
            with self.assertRaises(RuntimeError):
                scope.optimization_identity({'directory': directory})
            baseline['protocol']['samples'] = 1
            path.write_text(json.dumps(baseline))
            with self.assertRaises(RuntimeError):
                scope.optimization_identity({'directory': directory})


class TimingScopeTests(unittest.TestCase):
    def test_timing_requires_containment_regression_and_world_before_fixed_stack_cases(self):
        review = {'timing': dict(scope.TIMING_CONFIG)}
        self.assertEqual(scope.cases_for(review)[:5], scope.CASES[:3] + ('ss-owned-regression', 'world-reference'))
        self.assertEqual(len(scope.cases_for(review)), 10)
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory)
            (packet / 'review.json').write_text(json.dumps(review))
            with self.assertRaises(FileNotFoundError):
                runner.require_sequence(packet, 'ss-stack-plain')
            with self.assertRaisesRegex(RuntimeError, 'outside'):
                runner.require_sequence(packet, 'mj-resting-stack')
            self.assertTrue(scope.node_command(packet / 'ss-stack-clock-ab-1')[2].endswith('timing-runner.mjs'))

    def test_timing_rejects_mixed_modes_and_mutated_limits_or_baselines(self):
        for mode in ('profile', 'optimization'):
            with self.assertRaises(RuntimeError):
                scope.cases_for({'timing': scope.TIMING_CONFIG, mode: {}})
        for key, value in (('scene', 'free-drift'), ('maxStepRecords', 100000),
                           ('maxGcEvents', 100000), ('maxDiagnosticBytes', 2**30),
                           ('originalBundle', 'other.mjs'), ('bundleSha256', 'changed')):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                scope.cases_for({'timing': {**scope.TIMING_CONFIG, key: value}})

    def test_timing_freezes_all_engine_code_replay_protocol_and_bundle(self):
        baseline = scope.read_json(scope.ROOT / scope.TIMING_CONFIG['baselinePacket'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'packet.json'
            identity = {'directory': directory, 'bundleSha256': scope.TIMING_CONFIG['bundleSha256']}
            path.write_text(json.dumps(baseline))
            self.assertEqual(scope.timing_identity(identity), scope.TIMING_CONFIG)
            with self.assertRaises(RuntimeError):
                scope.timing_identity({**identity, 'bundleSha256': 'changed'})
            for target in ('engine/experimental/multiphysics/rigid.ts', 'scripts/collision-reference/state-space.mjs'):
                changed = json.loads(json.dumps(baseline))
                next(r for r in changed['files'] if r['path'] == target)['sha256'] = 'changed'
                path.write_text(json.dumps(changed))
                with self.assertRaises(RuntimeError):
                    scope.timing_identity(identity)
            baseline['protocol']['samples'] = 1
            path.write_text(json.dumps(baseline))
            with self.assertRaises(RuntimeError):
                scope.timing_identity(identity)


class CacheTimingScopeTests(unittest.TestCase):
    def test_fixed_sequence_retains_all_gates_and_does_not_launch_mujoco_or_inspector(self):
        review = {'cacheTiming': dict(scope.CACHE_TIMING_CONFIG)}
        self.assertEqual(scope.cases_for(review), scope.TIMING_CASES[:4] + ('ss-normal-cache-regression',) + scope.TIMING_CASES[4:])
        self.assertEqual(len(scope.cases_for(review)), 11)
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory)
            (packet / 'review.json').write_text(json.dumps(review))
            with self.assertRaises(FileNotFoundError):
                runner.require_sequence(packet, 'ss-stack-plain')
            with self.assertRaisesRegex(RuntimeError, 'outside'):
                runner.require_sequence(packet, 'mj-resting-stack')
            command = scope.node_command(packet / 'ss-stack-clock-ab-1')
            self.assertTrue(command[2].endswith('cache-timing-runner.mjs'))
            self.assertNotIn('--inspect', ' '.join(command))

    def test_mixed_modes_and_budget_or_control_mutations_fail_closed(self):
        for mode in ('profile', 'optimization', 'timing', 'solver', 'normalCache'):
            with self.subTest(mode=mode), self.assertRaises(RuntimeError):
                scope.cases_for({'cacheTiming': scope.CACHE_TIMING_CONFIG, mode: {}})
        for key, value in (('scene', 'free-drift'), ('maxStepRecords', 100000),
                           ('maxGcEvents', 100000), ('maxDiagnosticBytes', 2**30),
                           ('originalBundle', 'other.mjs'), ('bundleSha256', 'changed')):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                scope.cases_for({'cacheTiming': {**scope.CACHE_TIMING_CONFIG, key: value}})

    def test_every_engine_file_replay_wrapper_fixture_and_protocol_remain_frozen(self):
        baseline = scope.read_json(scope.ROOT / scope.CACHE_TIMING_CONFIG['baselinePacket'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'packet.json'
            identity = {'directory': directory, 'bundleSha256': scope.CACHE_TIMING_CONFIG['bundleSha256']}
            path.write_text(json.dumps(baseline))
            self.assertEqual(scope.cache_timing_identity(identity), scope.CACHE_TIMING_CONFIG)
            with self.assertRaises(RuntimeError):
                scope.cache_timing_identity({**identity, 'bundleSha256': 'changed'})
            for target in ('engine/experimental/multiphysics/rigid.ts', 'scripts/collision-reference/state-space.mjs',
                           'scripts/collision-reference/timing-data.mjs', 'scripts/collision-reference/normal-cache-regression.mjs'):
                changed = json.loads(json.dumps(baseline))
                next(r for r in changed['files'] if r['path'] == target)['sha256'] = 'changed'
                path.write_text(json.dumps(changed))
                with self.assertRaises(RuntimeError):
                    scope.cache_timing_identity(identity)
            for field in ('protocol', 'fixtures'):
                changed = {**baseline, field: {}}
                path.write_text(json.dumps(changed))
                with self.assertRaises(RuntimeError):
                    scope.cache_timing_identity(identity)


class OffsetTimingScopeTests(unittest.TestCase):
    def test_fixed_sequence_retains_all_gates_and_does_not_launch_mujoco_or_inspector(self):
        review = {'offsetTiming': dict(scope.OFFSET_TIMING_CONFIG)}
        self.assertEqual(scope.cases_for(review), scope.TIMING_CASES[:4] + ('ss-normal-cache-regression',) + scope.TIMING_CASES[4:])
        self.assertEqual(len(scope.cases_for(review)), 11)
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory)
            (packet / 'review.json').write_text(json.dumps(review))
            with self.assertRaises(FileNotFoundError):
                runner.require_sequence(packet, 'ss-stack-plain')
            with self.assertRaisesRegex(RuntimeError, 'outside'):
                runner.require_sequence(packet, 'mj-resting-stack')
            command = scope.node_command(packet / 'ss-stack-clock-ab-1')
            self.assertTrue(command[2].endswith('offset-timing-runner.mjs'))
            self.assertNotIn('--inspect', ' '.join(command))

    def test_mixed_modes_and_budget_or_control_mutations_fail_closed(self):
        for mode in ('profile', 'optimization', 'timing', 'solver', 'normalCache', 'cacheTiming', 'cacheSolver', 'offsetCache'):
            with self.subTest(mode=mode), self.assertRaises(RuntimeError):
                scope.cases_for({'offsetTiming': scope.OFFSET_TIMING_CONFIG, mode: {}})
        for key, value in (('scene', 'free-drift'), ('maxStepRecords', 100000),
                           ('maxGcEvents', 100000), ('maxDiagnosticBytes', 2**30),
                           ('originalBundle', 'other.mjs'), ('bundleSha256', 'changed')):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                scope.cases_for({'offsetTiming': {**scope.OFFSET_TIMING_CONFIG, key: value}})

    def test_every_engine_file_replay_wrapper_fixture_and_protocol_remain_frozen(self):
        baseline = scope.read_json(scope.ROOT / scope.OFFSET_TIMING_CONFIG['baselinePacket'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'packet.json'
            identity = {'directory': directory, 'bundleSha256': scope.OFFSET_TIMING_CONFIG['bundleSha256']}
            path.write_text(json.dumps(baseline))
            self.assertEqual(scope.offset_timing_identity(identity), scope.OFFSET_TIMING_CONFIG)
            with self.assertRaises(RuntimeError):
                scope.offset_timing_identity({**identity, 'bundleSha256': 'changed'})
            for target in ('engine/experimental/multiphysics/rigid.ts', 'scripts/collision-reference/state-space.mjs',
                           'scripts/collision-reference/timing-data.mjs', 'scripts/collision-reference/normal-cache-regression.mjs',
                           'scripts/collision-reference/cache-timing-data.mjs'):
                changed = json.loads(json.dumps(baseline))
                next(r for r in changed['files'] if r['path'] == target)['sha256'] = 'changed'
                path.write_text(json.dumps(changed))
                with self.assertRaises(RuntimeError):
                    scope.offset_timing_identity(identity)
            for field in ('protocol', 'fixtures'):
                changed = {**baseline, field: {}}
                path.write_text(json.dumps(changed))
                with self.assertRaises(RuntimeError):
                    scope.offset_timing_identity(identity)


class CacheSolverScopeTests(unittest.TestCase):
    def test_fixed_sequence_and_runner_keep_both_regressions_and_world_before_profiles(self):
        review = {'cacheSolver': dict(scope.CACHE_SOLVER_CONFIG)}
        self.assertEqual(scope.cases_for(review), scope.SOLVER_CASES[:4] + ('ss-normal-cache-regression',) + scope.SOLVER_CASES[4:])
        self.assertEqual(len(scope.cases_for(review)), 10)
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory)
            (packet / 'review.json').write_text(json.dumps(review))
            with self.assertRaises(FileNotFoundError):
                runner.require_sequence(packet, 'ss-stack-solver-profile-1')
            with self.assertRaisesRegex(RuntimeError, 'outside'):
                runner.require_sequence(packet, 'ss-stack-plain')
            command = scope.node_command(packet / 'ss-stack-solver-counts')
            self.assertTrue(command[2].endswith('cache-solver-profile-runner.mjs'))
            self.assertNotIn('--inspect', ' '.join(command))

    def test_mutated_or_combined_recipe_is_rejected(self):
        for mode in ('profile', 'optimization', 'timing', 'solver', 'normalCache', 'cacheTiming'):
            with self.subTest(mode=mode), self.assertRaises(RuntimeError):
                scope.cases_for({'cacheSolver': scope.CACHE_SOLVER_CONFIG, mode: {}})
        for key, value in (('scene', 'free-drift'), ('coverageDt', .008), ('samplingIntervalMicros', 1),
                           ('maxProfileBytes', 2**30), ('coverageDetailed', False),
                           ('originalBundle', 'other.mjs'), ('coverageBaseline', 'other.json')):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                scope.cases_for({'cacheSolver': {**scope.CACHE_SOLVER_CONFIG, key: value}})

    def test_engine_harness_and_attribution_identity_fail_on_drift(self):
        baseline = scope.read_json(scope.ROOT / scope.CACHE_SOLVER_CONFIG['baselinePacket'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'packet.json'
            identity = {'directory': directory, 'bundleSha256': scope.CACHE_SOLVER_CONFIG['bundleSha256']}
            path.write_text(json.dumps(baseline))
            self.assertEqual(scope.cache_solver_identity(identity), scope.CACHE_SOLVER_CONFIG)
            with self.assertRaises(RuntimeError):
                scope.cache_solver_identity({**identity, 'bundleSha256': 'changed'})
            for target in ('engine/experimental/multiphysics/rigid.ts', 'scripts/collision-reference/state-space.mjs',
                           'scripts/collision-reference/profile-data.mjs', 'scripts/collision-reference/solver-profile-data.mjs'):
                changed = json.loads(json.dumps(baseline))
                next(r for r in changed['files'] if r['path'] == target)['sha256'] = 'changed'
                path.write_text(json.dumps(changed))
                with self.assertRaises(RuntimeError):
                    scope.cache_solver_identity(identity)


class SolverScopeTests(unittest.TestCase):
    def test_solver_prerequisites_and_fixed_runner(self):
        review = {'solver': dict(scope.SOLVER_CONFIG)}
        self.assertEqual(scope.cases_for(review)[:5], scope.CASES[:3] + ('ss-owned-regression', 'world-reference'))
        self.assertEqual(len(scope.cases_for(review)), 9)
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory)
            (packet / 'review.json').write_text(json.dumps(review))
            with self.assertRaises(FileNotFoundError):
                runner.require_sequence(packet, 'ss-stack-solver-profile-1')
            with self.assertRaisesRegex(RuntimeError, 'outside'):
                runner.require_sequence(packet, 'ss-stack-plain')
            self.assertTrue(scope.node_command(packet / 'ss-stack-solver-counts')[2].endswith('solver-profile-runner.mjs'))

    def test_solver_rejects_mixed_modes_and_changed_recipe(self):
        for mode in ('profile', 'optimization', 'timing'):
            with self.assertRaises(RuntimeError):
                scope.cases_for({'solver': scope.SOLVER_CONFIG, mode: {}})
        for key, value in (('scene', 'free-drift'), ('coverageDt', .008),
                           ('coverageDetailed', False), ('samplingIntervalMicros', 1),
                           ('maxProfileBytes', 2**30), ('bundleSha256', 'changed')):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                scope.cases_for({'solver': {**scope.SOLVER_CONFIG, key: value}})

    def test_solver_reuses_full_engine_and_replay_identity(self):
        with patch.object(scope, 'timing_identity', return_value=scope.TIMING_CONFIG) as identity:
            self.assertEqual(scope.solver_identity({'test': True}), scope.SOLVER_CONFIG)
            identity.assert_called_once_with({'test': True})
        with patch.object(scope, 'timing_identity', side_effect=RuntimeError('engine/replay drift')):
            with self.assertRaisesRegex(RuntimeError, 'engine/replay drift'):
                scope.solver_identity({'test': True})


class OffsetCacheScopeTests(unittest.TestCase):
    def test_fixed_sequence_and_mutual_exclusion(self):
        review = {'offsetCache': dict(scope.OFFSET_CACHE_CONFIG)}
        self.assertEqual(len(scope.cases_for(review)), 21)
        self.assertEqual(scope.cases_for(review)[3:6], ('ss-owned-regression', 'ss-normal-cache-regression', 'world-reference'))
        self.assertEqual(scope.cases_for(review)[-1], 'ss-offset-cache-counts')
        for mode in ('profile', 'optimization', 'timing', 'solver', 'normalCache', 'cacheTiming', 'cacheSolver'):
            with self.assertRaises(RuntimeError):
                scope.cases_for({**review, mode: {}})
        for key, value in (('coverageDt', .016), ('maxCoverageBytes', 2**30), ('freshBaselineControls', False)):
            with self.assertRaises(RuntimeError):
                scope.cases_for({'offsetCache': {**scope.OFFSET_CACHE_CONFIG, key: value}})
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory)
            (packet / 'review.json').write_text(json.dumps(review))
            with self.assertRaises(FileNotFoundError):
                runner.require_sequence(packet, 'ss-offset-cache-counts')
            self.assertTrue(scope.node_command(packet / 'ss-normal-cache-regression')[2].endswith('offset-cache-runner.mjs'))

    def test_identity_allows_only_rigid_change_and_preserves_all_replay_and_diagnostics(self):
        baseline = scope.read_json(scope.ROOT / scope.OFFSET_CACHE_CONFIG['baselinePacket'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'packet.json'
            changed = json.loads(json.dumps(baseline))
            next(r for r in changed['files'] if r['path'] == 'engine/experimental/multiphysics/rigid.ts')['sha256'] = 'offset-cache'
            path.write_text(json.dumps(changed))
            self.assertEqual(scope.offset_cache_identity({'directory': directory}), scope.OFFSET_CACHE_CONFIG)
            for target in ('engine/experimental/multiphysics/math.ts', 'scripts/collision-reference/state-space.mjs',
                           'scripts/collision-reference/normal-cache-regression.mjs', 'scripts/collision-reference/solver-profile-data.mjs'):
                bad = json.loads(json.dumps(changed))
                next(r for r in bad['files'] if r['path'] == target)['sha256'] = 'drift'
                path.write_text(json.dumps(bad))
                with self.assertRaises(RuntimeError):
                    scope.offset_cache_identity({'directory': directory})
            changed['protocol']['samples'] = 1
            path.write_text(json.dumps(changed))
            with self.assertRaises(RuntimeError):
                scope.offset_cache_identity({'directory': directory})


class NormalCacheScopeTests(unittest.TestCase):
    def test_fixed_cache_sequence_and_mutual_exclusion(self):
        review = {'normalCache': dict(scope.NORMAL_CACHE_CONFIG)}
        self.assertEqual(len(scope.cases_for(review)), 21)
        self.assertEqual(scope.cases_for(review)[3:6], ('ss-owned-regression', 'ss-normal-cache-regression', 'world-reference'))
        self.assertEqual(scope.cases_for(review)[-1], 'ss-normal-cache-counts')
        for mode in ('profile', 'optimization', 'timing', 'solver'):
            with self.assertRaises(RuntimeError):
                scope.cases_for({**review, mode: {}})
        for key, value in (('coverageDt', .016), ('maxCoverageBytes', 2**30), ('baselineBundleSha256', 'changed')):
            with self.assertRaises(RuntimeError):
                scope.cases_for({'normalCache': {**scope.NORMAL_CACHE_CONFIG, key: value}})
        with tempfile.TemporaryDirectory() as directory:
            packet = Path(directory)
            (packet / 'review.json').write_text(json.dumps(review))
            with self.assertRaises(FileNotFoundError):
                runner.require_sequence(packet, 'ss-normal-cache-counts')
            self.assertTrue(scope.node_command(packet / 'ss-normal-cache-regression')[2].endswith('optimized-runner.mjs'))

    def test_cache_identity_allows_only_rigid_change_and_freezes_replay(self):
        baseline = scope.read_json(scope.ROOT / scope.NORMAL_CACHE_CONFIG['baselinePacket'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'packet.json'
            changed = json.loads(json.dumps(baseline))
            next(r for r in changed['files'] if r['path'] == 'engine/experimental/multiphysics/rigid.ts')['sha256'] = 'cache'
            path.write_text(json.dumps(changed))
            self.assertEqual(scope.normal_cache_identity({'directory': directory}), scope.NORMAL_CACHE_CONFIG)
            for target in ('engine/experimental/multiphysics/math.ts', 'scripts/collision-reference/state-space.mjs'):
                bad = json.loads(json.dumps(changed))
                next(r for r in bad['files'] if r['path'] == target)['sha256'] = 'drift'
                path.write_text(json.dumps(bad))
                with self.assertRaises(RuntimeError):
                    scope.normal_cache_identity({'directory': directory})


class QuietWindowTests(unittest.TestCase):
    def simulate(self, values, *, sleep_scale=1, stale=False):
        clock = [0.0]
        stream = iter([(0, 32768), *values])
        saved = []

        def sample():
            cpu, memory = next(stream)
            return {'time': 1000 + clock[0] - (3 if stale else 0),
                    'hostCpuPercent': cpu, 'freeMemoryMiB': memory}

        def sleep(seconds):
            clock[0] += seconds * sleep_scale

        with patch.object(runner, 'HostHealth') as health, \
                patch.object(runner.time, 'sleep', side_effect=sleep), \
                patch.object(runner.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(runner.time, 'time', side_effect=lambda: 1000 + clock[0]), \
                patch.object(runner, 'durable_json', side_effect=lambda path, value:
                             saved.append(json.loads(json.dumps(value)))):
            health.return_value.sample.side_effect = sample
            passed = runner.quiet_window(Path('mock-only.json'))
        return passed, saved, clock[0]

    def test_busy_sample_requires_a_new_full_quiet_window_and_retains_history(self):
        passed, saved, elapsed = self.simulate([(5, 32768)] * 10 + [(31, 32768)] + [(5, 32768)] * 30)
        self.assertTrue(passed)
        self.assertEqual(elapsed, 41)
        self.assertEqual(saved[-1]['elapsedSeconds'], 30)
        self.assertEqual(len(saved[-1]['samples']), 30)
        self.assertEqual(len(saved[-1]['observations']), 41)
        self.assertIn('quiet threshold', saved[-1]['observations'][10]['reason'])
        self.assertTrue(all(row['hostCpuPercent'] <= 30 for row in saved[-1]['samples']))
        self.assertTrue(all(row['passed'] is False for row in saved[:-1]))

    def test_low_memory_resets_the_window_without_loosening_either_limit(self):
        passed, saved, elapsed = self.simulate([(30, 8192)] * 10 + [(5, 8191)] + [(30, 8192)] * 30)
        self.assertTrue(passed)
        self.assertEqual(elapsed, 41)
        self.assertEqual(saved[-1]['elapsedSeconds'], 30)
        self.assertEqual(scope.LIMITS['cpuPercent'], 6)
        self.assertEqual(scope.LIMITS['memoryMiB'], 4096)
        self.assertEqual(scope.LIMITS['deadlineSeconds'], 30)

    def test_no_full_quiet_window_stops_at_the_bounded_observation_deadline(self):
        passed, saved, elapsed = self.simulate([
            (31 if i % 20 == 19 else 5, 32768) for i in range(90)])
        self.assertFalse(passed)
        self.assertEqual(elapsed, 90)
        self.assertEqual(saved[-1]['observationLimitSeconds'], 90)
        self.assertTrue(all(row['passed'] is False for row in saved))

    def test_polling_gap_cannot_count_as_quiet_observation(self):
        with self.assertRaisesRegex(RuntimeError, 'sampling gap'):
            self.simulate([(0, 32768)], sleep_scale=3)

    def test_stale_or_invalid_telemetry_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'Missing or stale'):
            self.simulate([(0, 32768)], stale=True)
        with self.assertRaisesRegex(RuntimeError, 'Invalid host CPU'):
            self.simulate([(float('nan'), 32768)])


class CleanupTests(unittest.TestCase):
    def fault(self, terminate_fails=False):
        with tempfile.TemporaryDirectory() as directory:
            attempt = Path(directory)
            run_id = 'b' * 32
            (attempt / 'armed.json').write_text(json.dumps({'runId': run_id, 'watchdogPid': 123}))
            (attempt / 'child.json').write_text(json.dumps({'pid': 456}))
            job = Mock(handle=1)
            job.pids.side_effect = RuntimeError('Incomplete owned-process inventory')
            job.active_processes.return_value = 0
            if terminate_fails:
                job.terminate.side_effect = RuntimeError('Injected termination failure')
            probe = Mock(handle=None)
            supervisor = Mock(pid=12)
            supervisor.poll.return_value = supervisor.wait.return_value = 1
            watchdog, child = Mock(), Mock()
            watchdog.code.return_value = child.code.return_value = 125
            class Mapping(bytearray):
                def close(self):
                    self.closed = True
            mapping = Mapping(runner.SIZE)
            mapping[:8] = runner.MAGIC
            struct.pack_into('<I', mapping, runner.REASON, 1)
            cap = {'runId': run_id, 'mode': 'cpu-only', 'case': 'supervisor-loss',
                   'limits': scope.LIMITS, 'reviewSha256': 'review', 'supervisorCommand': ['mock-only']}
            with ExitStack() as stack:
                stack.enter_context(patch.object(runner.subprocess, 'Popen', return_value=supervisor))
                stack.enter_context(patch.object(runner, 'JobObserver', side_effect=[job, probe]))
                stack.enter_context(patch.object(runner, 'ProcessObserver', side_effect=[watchdog, child]))
                stack.enter_context(patch.object(runner.mmap, 'mmap', return_value=mapping))
                health = stack.enter_context(patch.object(runner, 'HostHealth'))
                health.return_value.sample.return_value = {
                    'time': time.time(), 'hostCpuPercent': 1, 'freeMemoryMiB': 32768}
                report = runner.observe(attempt, cap)
            return report, job, watchdog, child, mapping

    def test_inventory_failure_retains_outcomes_and_terminates_independently(self):
        report, job, watchdog, child, mapping = self.fault()
        self.assertFalse(report['passed'])
        self.assertEqual(report['outcomeBeforeCleanup']['watchdogReasonCode'], 1)
        self.assertEqual(report['outcomeBeforeCleanup']['watchdogExitCode'], 125)
        job.terminate.assert_called_once()
        job.close.assert_called_once()
        watchdog.close.assert_called_once()
        child.close.assert_called_once()
        self.assertTrue(mapping.closed)

    def test_failed_cleanup_cannot_pass_and_does_not_skip_other_handles(self):
        report, job, watchdog, child, mapping = self.fault(terminate_fails=True)
        self.assertFalse(report['passed'])
        self.assertIn('Injected termination failure', str(report['cleanupErrors']))
        job.close.assert_called_once()
        watchdog.close.assert_called_once()
        child.close.assert_called_once()
        self.assertTrue(mapping.closed)


if __name__ == '__main__':
    unittest.main()

