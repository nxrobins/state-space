"""Mock socket tests for the deliberately small blank-page CDP protocol."""
import json
from pathlib import Path
import struct
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from scripts.verification_restricted_browser import (
    METHODS, BlankCDP, assert_arguments, assert_blank_targets, assert_hardware_gpu, wait_blank_targets,
)
from scripts.verification_scope import browser_arguments


class CDPTests(unittest.TestCase):
    def client(self, data=b''):
        client = BlankCDP.__new__(BlankCDP)
        client.socket = Mock()
        buffer = bytearray(data)

        def recv(count):
            result = bytes(buffer[:count])
            del buffer[:count]
            return result
        client.socket.recv.side_effect = recv
        client.next_id = 0
        client.pending = None
        client.methods = METHODS
        return client

    def frame(self, value):
        data = json.dumps(value).encode()
        self.assertLess(len(data), 126)
        return bytes([0x81, len(data)]) + data

    def test_fixed_call_round_trip(self):
        client = self.client(self.frame({'id': 1, 'result': {'product': 'test'}}))
        self.assertEqual(client.call('Browser.getVersion'), {'product': 'test'})
        self.assertIsNone(client.pending)
        frame = client.socket.sendall.call_args.args[0]
        self.assertEqual(frame[0], 0x81)
        self.assertTrue(frame[1] & 128)
        mask, payload = frame[2:6], frame[6:]
        decoded = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.assertEqual(json.loads(decoded), {'id': 1, 'method': 'Browser.getVersion'})

    def test_arbitrary_eval_navigation_and_overlapping_requests_are_rejected(self):
        client = self.client()
        for method in ('Runtime.evaluate', 'Page.navigate', 'Target.createTarget', 'Browser.crash'):
            with self.assertRaises(RuntimeError):
                client.send(method)
        client.socket.sendall.assert_not_called()
        client.send('Browser.getVersion')
        with self.assertRaises(RuntimeError):
            client.send('Browser.close')

    def test_bad_response_and_lost_connection(self):
        for value in ({'id': 2, 'result': {}}, {'id': True, 'result': {}},
                      {'id': 1, 'error': {}}, {'method': 'unexpected'}, {'id': 1, 'result': []}):
            client = self.client(self.frame(value))
            client.send('Browser.getVersion')
            with self.assertRaises(RuntimeError):
                client.receive()
        client = self.client()
        client.send('Browser.getVersion')
        with self.assertRaisesRegex(RuntimeError, 'closed'):
            client.receive()

    def test_oversized_fragmented_masked_and_control_frames(self):
        for data in (b'\x81\x7f' + struct.pack('!Q', 65537), b'\x01\x00', b'\x81\x80', b'\x88\x00'):
            client = self.client(data)
            client.send('Browser.getVersion')
            with self.assertRaises(RuntimeError):
                client.receive()

    def test_socket_timeout_is_not_swallowed(self):
        client = self.client()
        client.socket.recv.side_effect = TimeoutError('stalled')
        client.send('Browser.getVersion')
        with self.assertRaises(TimeoutError):
            client.receive()

    def test_endpoint_restriction_precedes_connection(self):
        with patch('socket.create_connection') as connect:
            for port, path in ((80, '/devtools/browser/' + 'a' * 36), (9222, 'ws://remote/'),
                               (True, '/devtools/browser/' + 'a' * 36)):
                with self.assertRaises(RuntimeError):
                    BlankCDP(port, path)
            connect.assert_not_called()

    def test_blank_page_only(self):
        assert_blank_targets({'targetInfos': [{'type': 'page', 'url': 'about:blank'}]})
        for targets in ([], [{'type': 'page', 'url': 'https://example.com'}],
                        [{'type': 'service_worker', 'url': 'about:blank'}],
                        [{'type': 'page', 'url': 'about:blank'}] * 2):
            with self.assertRaises(RuntimeError):
                assert_blank_targets({'targetInfos': targets})

    def test_flags_are_fixed_gpu_disabled_and_sandbox_preserved(self):
        args = browser_arguments('owned-profile')
        for flag in ('--disable-gpu', '--disable-software-rasterizer', '--disable-webgpu',
                     '--disable-blink-features=WebGPU', '--disable-3d-apis'):
            self.assertIn(flag, args)
        self.assertNotIn('--no-sandbox', args)
        self.assertNotIn('--enable-unsafe-webgpu', args)
        assert_arguments(['chrome.exe', *args], args)
        with self.assertRaises(RuntimeError):
            assert_arguments(['chrome.exe', *args, '--enable-unsafe-webgpu'], args)

    def test_only_empty_chrome_experiment_delimiters_are_accepted(self):
        args = browser_arguments('owned-profile')
        assert_arguments(['chrome.exe', *args[:-1], '--flag-switches-begin',
                          '--flag-switches-end', args[-1]], args)
        for extra in (['--flag-switches-begin', '--enable-gpu', '--flag-switches-end'],
                      ['--flag-switches-begin'], ['--flag-switches-end', '--flag-switches-begin'],
                      ['--flag-switches-begin', '--flag-switches-end'] * 2):
            with self.assertRaises(RuntimeError):
                assert_arguments(['chrome.exe', *args, *extra], args)

    def test_flag_values_duplicates_and_missing_flags_remain_failures(self):
        args = browser_arguments('owned-profile')
        for bad in ([*args, '--disable-gpu'], args[1:],
                    [arg.replace('owned-profile', 'user-profile') for arg in args]):
            with self.assertRaises(RuntimeError):
                assert_arguments(['chrome.exe', *bad], args)

    def test_gpu_mode_is_explicit_and_does_not_relax_driver_or_sandbox(self):
        args = browser_arguments('owned-profile', 'gpu-enabled')
        self.assertIn('--enable-gpu', args)
        self.assertIn('--disable-software-rasterizer', args)
        for flag in ('--disable-gpu', '--disable-webgpu', '--enable-unsafe-webgpu',
                     '--disable-gpu-watchdog', '--no-sandbox'):
            self.assertNotIn(flag, args)
        client = self.client()
        with self.assertRaises(RuntimeError):
            client.send('SystemInfo.getInfo')
        client.methods += ('SystemInfo.getInfo',)
        client.send('SystemInfo.getInfo')

    def test_empty_initial_targets_wait_but_unexpected_targets_fail(self):
        good = {'targetInfos': [{'type': 'page', 'url': 'about:blank'}]}
        with tempfile.TemporaryDirectory() as directory, patch('time.sleep'):
            path = Path(directory)
            cdp = Mock()
            cdp.call.side_effect = [{'targetInfos': []}, good]
            self.assertEqual(wait_blank_targets(cdp, path, time.monotonic() + 2), good)
            self.assertEqual(len(json.loads((path / 'browser-targets.json').read_text())['observations']), 2)
            cdp.call.side_effect = [{'targetInfos': [{'type': 'page', 'url': 'chrome://newtab/'}]}]
            with self.assertRaisesRegex(RuntimeError, 'single approved'):
                wait_blank_targets(cdp, path, time.monotonic() + 2)
            self.assertEqual(json.loads((path / 'browser-targets.json').read_text())['observations'][0]
                             ['targetInfos'][0]['url'], 'chrome://newtab/')

    def test_empty_target_wait_has_a_hard_call_bound(self):
        with tempfile.TemporaryDirectory() as directory, patch('time.sleep'):
            cdp = Mock()
            cdp.call.return_value = {'targetInfos': []}
            with self.assertRaisesRegex(RuntimeError, 'within its bound'):
                wait_blank_targets(cdp, Path(directory), time.monotonic() + 2)
            self.assertLessEqual(cdp.call.call_count, 20)

    def test_hardware_gpu_requires_device_and_enabled_compositing(self):
        good = {'devices': [{'vendorId': 0x10de, 'deviceId': 1}],
                'featureStatus': {'gpu_compositing': 'enabled'},
                'auxAttributes': {'glRenderer': 'ANGLE NVIDIA D3D11'}}
        assert_hardware_gpu({'gpu': good})
        for changed in ({'devices': []}, {'featureStatus': {'gpu_compositing': 'disabled_software'}},
                        {'auxAttributes': {'glRenderer': 'SwiftShader software'}}):
            with self.assertRaises(RuntimeError):
                assert_hardware_gpu({'gpu': {**good, **changed}})

    def test_observed_internal_and_component_targets_are_disabled_not_hidden(self):
        observed = [
            {'type': 'page', 'url': 'about:blank'},
            {'type': 'browser_ui', 'url': 'chrome://omnibox-popup.top-chrome/'},
            {'type': 'browser_ui', 'url': 'chrome://omnibox-popup.top-chrome/omnibox_popup_aim.html'},
            {'type': 'background_page', 'url': 'chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome/background.html'},
        ]
        with self.assertRaises(RuntimeError):
            assert_blank_targets({'targetInfos': observed})
        for mode in ('gpu-disabled', 'gpu-enabled'):
            args = browser_arguments('owned-profile', mode)
            self.assertIn('--disable-component-extensions-with-background-pages', args)
            disabled = next(arg for arg in args if arg.startswith('--disable-features='))
            self.assertIn('WebUIOmniboxPopup', disabled.split('=', 1)[1].split(','))
            self.assertIn('WebUIOmniboxAimPopup', disabled.split('=', 1)[1].split(','))


if __name__ == '__main__':
    unittest.main()
