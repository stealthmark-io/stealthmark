"""In-memory usage event queue with a background flusher into the usage_records ledger."""
import asyncio
import time
from typing import Any, Optional

import httpx

from gateway import postgrest
from gateway.config import logger

FLUSH_INTERVAL_SECONDS = 1.0
FLUSH_MAX_BATCH = 500
FLUSH_MAX_ATTEMPTS = 3
QUEUE_MAX_SIZE = 10000
SHUTDOWN_DRAIN_SECONDS = 5.0


class UsageQueue:
    """In-memory event queue with a background flusher that batches inserts into usage_records."""

    def __init__(
        self,
        flush_interval: float = FLUSH_INTERVAL_SECONDS,
        max_batch: int = FLUSH_MAX_BATCH,
        max_size: int = QUEUE_MAX_SIZE,
        max_attempts: int = FLUSH_MAX_ATTEMPTS,
    ):
        self.flush_interval = flush_interval
        self.max_batch = max_batch
        self.max_attempts = max_attempts
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=max_size)
        self.flushed = 0
        self.dropped = 0
        self._carry: list[dict[str, Any]] = []
        self._attempts = 0
        self._task: Optional[asyncio.Task[None]] = None

    def enqueue(self, row: dict[str, Any]) -> bool:
        try:
            self.queue.put_nowait(row)
            return True
        except asyncio.QueueFull:
            self.dropped += 1
            return False

    def pending(self) -> int:
        return self.queue.qsize() + len(self._carry)

    def _next_batch(self) -> list[dict[str, Any]]:
        rows, self._carry = self._carry, []
        while len(rows) < self.max_batch:
            try:
                rows.append(self.queue.get_nowait())
            except asyncio.QueueEmpty:
                break
        return rows

    async def _post(self, rows: list[dict[str, Any]]) -> bool:
        try:
            res = await postgrest.rest_insert("usage_records", rows)
        except httpx.HTTPError as exc:
            logger.warning("usage_records flush failed: %s", exc)
            return False
        if res.status_code >= 300:
            logger.warning("usage_records flush rejected with status %s", res.status_code)
            return False
        return True

    async def flush_once(self) -> int:
        """Send one batch. A failed batch is retried on the next tick and dropped after max_attempts."""
        rows = self._next_batch()
        if not rows:
            return 0
        if await self._post(rows):
            self.flushed += len(rows)
            self._attempts = 0
            return len(rows)
        self._attempts += 1
        if self._attempts >= self.max_attempts:
            self.dropped += len(rows)
            self._attempts = 0
            logger.error("dropped %s usage events after %s failed flushes", len(rows), self.max_attempts)
        else:
            self._carry = rows
        return 0

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(self.flush_interval)
            try:
                await self.flush_once()
            except Exception:
                logger.exception("usage flusher iteration failed")

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        deadline = time.monotonic() + SHUTDOWN_DRAIN_SECONDS
        while self.pending() and time.monotonic() < deadline:
            await self.flush_once()
