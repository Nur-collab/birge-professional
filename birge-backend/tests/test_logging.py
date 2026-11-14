import json
import logging

from fastapi.testclient import TestClient

import main
from logging_config import (
    JsonFormatter,
    RequestIdFilter,
    bind_request_id,
    reset_request_id,
)


class _CaptureHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


def test_json_formatter_includes_request_id():
    token = bind_request_id("req-json")
    try:
        record = logging.LogRecord(
            "birge", logging.INFO, __file__, 10, "hello %s", ("world",), None
        )
        RequestIdFilter().filter(record)
        payload = json.loads(JsonFormatter().format(record))
    finally:
        reset_request_id(token)

    assert payload["request_id"] == "req-json"
    assert payload["message"] == "hello world"
    assert payload["service"] == "birge-backend"
    assert payload["level"] == "INFO"


def test_request_id_from_header_is_written_to_request_log():
    handler = _CaptureHandler()
    handler.addFilter(RequestIdFilter())
    logger = logging.getLogger("birge")
    logger.addHandler(handler)
    try:
        response = TestClient(main.app).get(
            "/health", headers={"X-Request-ID": "req-http"}
        )
    finally:
        logger.removeHandler(handler)

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "req-http"
    records = [
        record
        for record in handler.records
        if getattr(record, "path", None) == "/health"
        and record.getMessage() == "request.complete"
    ]
    assert records
    assert records[-1].request_id == "req-http"
    assert records[-1].method == "GET"
    assert records[-1].status_code == 200
