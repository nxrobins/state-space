import copy
import unittest
from scripts.volume_latency_report import summarize_latency


def receipt(gpu=False):
    samples, records = [], []
    for tick in range(1, 601):
        start = tick * 20
        samples.append({'tick': tick, 'completedAt': start + 8, 'controllerCompletedAt': start + 4,
                        'renderInputSampledAt': start + 5,
                        'input': {'source': 'scripted', 'sampledAt': start, 'event': None}})
        for kind, offset in [('step', 0), ('render', 5)]:
            t = start + offset
            records.append({'id': len(records) + 1, 'tick': tick, 'kind': kind,
                            'cpu': {'startedAt': t, 'preparedAt': t, 'encodedAt': t + 1,
                                    'submittedAt': t + 1, 'queueCompletedAt': t + 2,
                                    'readbacksReadyAt': t + 2, 'completedAt': t + 3},
                            'gpu': {'status': 'complete' if gpu else 'disabled',
                                    'ms': ({'physicsPlanningAndCertification': 1, 'collisionQuery': 0}
                                           if kind == 'step' else {'mesh': 0, 'draw': .1}) if gpu else {}}})
    return {'samples': samples, 'latency': {'enabled': True, 'gpuTimingRequested': gpu,
                                          'gpuTimestamps': gpu, 'records': records}}


class LatencyReceiptTests(unittest.TestCase):
    def test_all_frames_and_explicit_cpu_or_gpu_modes(self):
        for gpu in (False, True):
            result = summarize_latency(receipt(gpu))
            self.assertTrue(result['passed'])
            self.assertEqual(result['records'], 1200)
            self.assertEqual(result['milliseconds']['inputSamplingToCompletion']['p95'], 8)

    def test_resident_frames_require_one_complete_record_and_compact_readback(self):
        value=receipt(True);value['gameplayBackend']='gpu'
        value['latency']['records']=value['latency']['records'][::2]
        for r in value['latency']['records']:
            r['kind']='gameplay'
            r['gpu']['ms']={'tools':.1,'physicsPlanningAndCertification':3,'collisionCache':.1,'controller':.1,'mesh':.1,'draw':.1}
        for row in value['samples']:
            row.update(submissions=1,completionBoundaries=1,actorReadbackBytes=512)
        self.assertEqual(summarize_latency(value)['records'],600)
        for corrupt in (
            lambda r:r['latency']['records'].pop(),
            lambda r:r['latency']['records'][0].update(kind='step'),
            lambda r:r['latency']['records'][0]['gpu']['ms'].pop('controller'),
            lambda r:r['samples'][0].update(completionBoundaries=2),
            lambda r:r['samples'][0].update(actorReadbackBytes=16384),
        ):
            invalid=copy.deepcopy(value);corrupt(invalid)
            with self.assertRaises(ValueError):summarize_latency(invalid)

    def test_missing_stale_failed_or_false_input_data_cannot_pass(self):
        original = receipt(True)
        for corrupt in (
            lambda r: r['latency']['records'].pop(),
            lambda r: r['samples'][2].update(tick=2),
            lambda r: r['latency']['records'][0]['gpu'].update(status='pending'),
            lambda r: r['latency']['records'][0]['cpu'].update(submittedAt=0),
            lambda r: r['latency']['records'][0]['gpu']['ms'].update(collisionQuery=float('nan')),
            lambda r: r['samples'][0]['input'].update(event={'timeStamp': 1}),
        ):
            invalid = copy.deepcopy(original); corrupt(invalid)
            with self.assertRaises(ValueError):
                summarize_latency(invalid)


if __name__ == '__main__':
    unittest.main()
