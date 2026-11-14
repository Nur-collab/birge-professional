"""Minimal RESP server for multiprocess realtime tests.

It implements only the Redis commands used by Birge's rate limiter and
Pub/Sub bus. Tests run against real redis-py clients over TCP; CI can point
them at a real Redis instance instead via TEST_REDIS_URL.
"""
from __future__ import annotations

import socketserver
import threading
from typing import Any


class _State:
    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}
        self.subscribers: dict[bytes, set["_Handler"]] = {}
        self.lock = threading.RLock()


class _Handler(socketserver.StreamRequestHandler):
    def setup(self) -> None:
        super().setup()
        self._write_lock = threading.Lock()

    def finish(self) -> None:
        try:
            with self.server.state.lock:  # type: ignore[attr-defined]
                for subscribers in self.server.state.subscribers.values():  # type: ignore[attr-defined]
                    subscribers.discard(self)
        finally:
            super().finish()

    def _send(self, payload: bytes) -> None:
        with self._write_lock:
            self.wfile.write(payload)
            self.wfile.flush()

    @staticmethod
    def _bulk(value: bytes) -> bytes:
        return b"$%d\r\n%s\r\n" % (len(value), value)

    def _array(self, values: list[bytes]) -> bytes:
        return b"*%d\r\n" % len(values) + b"".join(self._bulk(v) for v in values)

    def _read_command(self) -> list[bytes]:
        line = self.rfile.readline()
        if not line:
            raise ConnectionError("client disconnected")
        line = line.rstrip(b"\r\n")
        if not line:
            return []
        if not line.startswith(b"*"):
            return line.split()
        count = int(line[1:])
        args: list[bytes] = []
        for _ in range(count):
            header = self.rfile.readline().rstrip(b"\r\n")
            if not header.startswith(b"$"):
                raise ValueError(f"unexpected RESP header: {header!r}")
            size = int(header[1:])
            args.append(self.rfile.read(size))
            self.rfile.read(2)
        return args

    def _push_message(self, channel: bytes, payload: bytes) -> None:
        self._send(self._array([b"message", channel, payload]))

    def handle(self) -> None:  # noqa: C901 - small command switch for tests
        state: _State = self.server.state  # type: ignore[attr-defined]
        while True:
            try:
                args = self._read_command()
            except (ConnectionError, OSError, ValueError):
                break
            if not args:
                break
            command = args[0].upper()

            if command == b"PING":
                self._send(b"+PONG\r\n")
            elif command in (b"CLIENT", b"SELECT", b"AUTH"):
                self._send(b"+OK\r\n")
            elif command == b"QUIT":
                self._send(b"+OK\r\n")
                break
            elif command in (b"INCR", b"INCRBY") and len(args) >= 2:
                key = args[1].decode()
                with state.lock:
                    amount = int(args[2]) if len(args) >= 3 else 1
                    current = int(state.values.get(key, b"0")) + amount
                    state.values[key] = str(current).encode()
                self._send(f":{current}\r\n".encode())
            elif command == b"EXPIRE":
                self._send(b":1\r\n")
            elif command == b"GET" and len(args) >= 2:
                with state.lock:
                    value = state.values.get(args[1].decode())
                self._send(b"$-1\r\n" if value is None else self._bulk(value))
            elif command == b"SET" and len(args) >= 3:
                with state.lock:
                    state.values[args[1].decode()] = args[2]
                self._send(b"+OK\r\n")
            elif command == b"PUBLISH" and len(args) >= 3:
                channel, payload = args[1], args[2]
                with state.lock:
                    subscribers = list(state.subscribers.get(channel, ()))
                delivered = 0
                for subscriber in subscribers:
                    try:
                        subscriber._push_message(channel, payload)
                        delivered += 1
                    except OSError:
                        with state.lock:
                            state.subscribers.get(channel, set()).discard(subscriber)
                self._send(f":{delivered}\r\n".encode())
            elif command == b"SUBSCRIBE":
                for channel in args[1:]:
                    with state.lock:
                        subscribers = state.subscribers.setdefault(channel, set())
                        subscribers.add(self)
                        count = len(subscribers)
                    self._send(self._array([b"subscribe", channel, str(count).encode()]))
            elif command == b"UNSUBSCRIBE":
                channels = args[1:] or list(state.subscribers.keys())
                for channel in channels:
                    with state.lock:
                        subscribers = state.subscribers.get(channel, set())
                        subscribers.discard(self)
                        count = len(subscribers)
                        if not subscribers:
                            state.subscribers.pop(channel, None)
                    self._send(self._array([b"unsubscribe", channel, str(count).encode()]))
            elif command == b"FLUSHALL":
                with state.lock:
                    state.values.clear()
                self._send(b"+OK\r\n")
            elif command == b"COMMAND":
                self._send(b"*0\r\n")
            else:
                self._send(b"-ERR unknown command\r\n")


class _Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _Handler)
        self.state = _State()


class RedisStub:
    def __init__(self) -> None:
        self._server = _Server()
        self._thread = threading.Thread(
            target=self._server.serve_forever, name="redis-stub", daemon=True
        )

    @property
    def url(self) -> str:
        host, port = self._server.server_address
        return f"redis://{host}:{port}/0"

    def __enter__(self) -> "RedisStub":
        self._thread.start()
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)
