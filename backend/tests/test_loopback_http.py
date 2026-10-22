import sys
import unittest
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from loopback_http import BoundedHTTPServer
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class ConnectionBoundTests(unittest.TestCase):
    def server(self):
        server = BoundedHTTPServer(('127.0.0.1', 0), BaseHTTPRequestHandler)
        self.addCleanup(server.server_close)
        return server

    def test_full_connection_pool_rejects_before_creating_another_thread(self):
        server = self.server()
        for _ in range(server.max_connections):
            self.assertTrue(server._connections.acquire(False))
        request = mock.Mock()
        with mock.patch.object(server, 'shutdown_request') as shutdown, mock.patch.object(ThreadingHTTPServer, 'process_request') as process:
            server.process_request(request, ('127.0.0.1', 1))
        shutdown.assert_called_once_with(request)
        process.assert_not_called()

    def test_thread_failure_and_handler_completion_release_connection_capacity(self):
        server = self.server()
        with mock.patch.object(ThreadingHTTPServer, 'process_request', side_effect=RuntimeError('thread limit')):
            with self.assertRaises(RuntimeError): server.process_request(mock.Mock(), ('127.0.0.1', 1))
        for _ in range(server.max_connections): self.assertTrue(server._connections.acquire(False))
        with mock.patch.object(ThreadingHTTPServer, 'process_request_thread', side_effect=RuntimeError('handler failed')):
            with self.assertRaises(RuntimeError): server.process_request_thread(mock.Mock(), ('127.0.0.1', 1))
        self.assertTrue(server._connections.acquire(False))
        self.assertFalse(server._connections.acquire(False))
