"""Real host PTY coverage; physical Termux acceptance is recorded separately."""
import base64
import json
import os
import runpy
import subprocess
import sys
import threading
import time
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from workstation_terminal import Session, TerminalError, Handler, MAX_REPLAY, detect_presets, preset_argv
from loopback_http import BoundedHTTPServer

class TerminalPresetTests(unittest.TestCase):
    def test_metasploit_uses_managed_launcher_with_device_profile_and_no_history(self):
        argv = preset_argv('metasploit')
        self.assertEqual(argv, [sys.executable, str(Path(__file__).resolve().parents[1] / 'scripts/workstation-msf-console-launch'),
                                '--profile', 'termux-local', '--no-history'])
        with patch.object(sys, 'argv', argv[1:]), \
             patch('workstation_common.nh_argv', return_value=['/test/nh', 'fixed-command']) as nh, \
             patch('workstation_common.framework_session_lock') as lock, \
             patch('os.execv') as execute:
            runpy.run_path(argv[1], run_name='__main__')
        self.assertEqual(nh.call_args.args[0], 'python3')
        self.assertEqual(nh.call_args.args[1][-2:], ['-H', '/dev/null'])
        self.assertIn('skid-termux-local.json', nh.call_args.args[1][1])
        lock.assert_called_once_with(exclusive=False)
        execute.assert_called_once_with('/test/nh', ['/test/nh', 'fixed-command'])

    def test_presets_reject_arbitrary_commands(self):
        for preset in ['msfconsole', 'kali; id', '', None]:
            with self.assertRaises(ValueError):
                preset_argv(preset)

    def test_detection_requires_the_kali_tools_and_does_not_claim_database_readiness(self):
        with patch('os.access', return_value=True), \
             patch('workstation_common.resolve_nh_path', return_value=Path('/test/nh')), \
             patch('workstation_common.run_kali') as probe:
            probe.return_value = subprocess.CompletedProcess([], 0)
            self.assertEqual(detect_presets(), ['termux', 'kali', 'metasploit'])
            probe.return_value = subprocess.CompletedProcess([], 1)
            self.assertEqual(detect_presets(), ['termux', 'kali'])
            probe.side_effect = subprocess.TimeoutExpired('nh', 5)
            self.assertEqual(detect_presets(), ['termux', 'kali'])
        with patch('os.access', return_value=True), \
             patch('workstation_common.resolve_nh_path', return_value=None):
            self.assertEqual(detect_presets(), ['termux'])

class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.session = Session('a'*64, 'session-test', ['/bin/bash','--noprofile','--norc','-i'], '/tmp', dict(os.environ, TERM='xterm-256color', HISTFILE='/dev/null', PS1='ONI> '))
        self.seq = 0
        self.wait_for(b'ONI> ')

    def tearDown(self):
        self.session.request(dict(sessionId='session-test', operation='close'))
        deadline = time.monotonic()+3
        while not self.session.closed and time.monotonic()<deadline: time.sleep(.02)
        self.assertTrue(self.session.closed, 'owned shell was not reaped')

    def request(self, **value):
        return self.session.request(dict(sessionId='session-test', **value))

    def write(self, data):
        self.seq += 1
        return self.request(operation='write', sequence=self.seq, data=base64.b64encode(data).decode())

    def wait_for(self, text, offset=0):
        deadline = time.monotonic()+4
        data = bytearray()
        while time.monotonic()<deadline:
            result = self.request(operation='read', offset=offset)
            data.extend(base64.b64decode(result['data'])); offset=result['nextOffset']
            if text in data: return bytes(data)
            time.sleep(.02)
        self.fail('expected PTY output did not arrive')

    def test_persistent_shell_resize_utf8_and_interrupt(self):
        self.write(b'cd /; export ONI_TEST_VALUE=persistent\n')
        self.request(operation='resize', rows=31, columns=91)
        self.write("printf '\\033[31m%s:%s:雪\\033[0m\\n' \"$PWD\" \"$ONI_TEST_VALUE\"; stty size\n".encode())
        data=self.wait_for(b'31 91')
        self.assertIn('\x1b[31m/:persistent:雪\x1b[0m'.encode(),data)
        self.write(b'sleep 30\n'); time.sleep(.1); self.write(b'\x03')
        self.write(b'printf interrupt-ok\\n\n'); self.wait_for(b'interrupt-ok')

    def test_ownership_order_duplicate_and_invalid_payload(self):
        with self.assertRaises(TerminalError): self.session.request(dict(sessionId='other',operation='close'))
        with self.assertRaises(TerminalError): self.request(operation='write',sequence=5,data='YQ==')
        self.write(b'printf once-only\\n\n')
        self.request(operation='write',sequence=self.seq,data=base64.b64encode(b'printf once-only\\n\n').decode())
        with self.assertRaises(TerminalError): self.request(operation='write',sequence=self.seq,data='Yg==')
        for payload in [dict(operation='resize',rows=True,columns=80),dict(operation='read',offset=-1),dict(operation='write',sequence=2,data='?'),dict(operation='unknown')]:
            with self.assertRaises(TerminalError):self.request(**payload)

    def test_interrupted_write_is_never_reported_as_a_successful_duplicate(self):
        data=base64.b64encode(b'not sent').decode()
        with patch('workstation_terminal.os.write',side_effect=OSError('closed')):
            with self.assertRaises(OSError): self.request(operation='write',sequence=1,data=data)
        with self.assertRaisesRegex(TerminalError,'TERMINAL_INPUT_INTERRUPTED'):
            self.request(operation='write',sequence=1,data=data)

    def test_output_is_bounded_and_reports_replay_gap(self):
        self.write(b"head -c 1200000 /dev/zero | tr '\\0' x; echo OUTPUT_DONE\n")
        deadline=time.monotonic()+5
        while self.session.end<1200000 and time.monotonic()<deadline:time.sleep(.02)
        result=self.request(operation='read',offset=0)
        self.assertTrue(result['gap']);self.assertLessEqual(len(self.session.buffer),MAX_REPLAY)
        self.assertLessEqual(len(base64.b64decode(result['data'])),65536)

    def test_http_authentication_malformed_json_and_session_ownership(self):
        server=BoundedHTTPServer(('127.0.0.1',0),Handler);server.session=self.session
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url=f'http://127.0.0.1:{server.server_port}/v1/terminal'
        try:
            request=urllib.request.Request(url,data=b'{}',headers={'Authorization':'Bearer wrong'})
            with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(request)
            self.assertEqual(error.exception.code,403)
            for raw in [b'{',b'[]',b'{"sessionId":"other","operation":"close"}']:
                request=urllib.request.Request(url,data=raw,headers={'Authorization':'Bearer '+'a'*64})
                with urllib.request.urlopen(request) as result:self.assertFalse(json.load(result)['ok'])
            self.assertFalse(self.session.closed)
        finally:server.shutdown();server.server_close();thread.join(2)
