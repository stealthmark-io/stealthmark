"""In-memory abuse limits for metered events, kept per gateway instance."""
import time
from collections import OrderedDict
from typing import Callable, Hashable

BILLABLE_PER_IP_PER_MINUTE = 60
BLOCKED_PER_ORG_PER_HOUR = 1000
MAX_TRACKED_KEYS = 50_000


class EventGate:
    """LRU-bounded counters: billable events per (org, client ip, minute) and zero-unit blocked rows per (org, hour).

    An event over its limit is simply not recorded, so one address cannot drain an organization's credits
    and an attack cannot flood the ledger with free rows.
    """

    def __init__(
        self,
        billable_per_ip_per_minute: int = BILLABLE_PER_IP_PER_MINUTE,
        blocked_per_org_per_hour: int = BLOCKED_PER_ORG_PER_HOUR,
        max_keys: int = MAX_TRACKED_KEYS,
        clock: Callable[[], float] = time.time,
    ):
        self.billable_per_ip_per_minute = billable_per_ip_per_minute
        self.blocked_per_org_per_hour = blocked_per_org_per_hour
        self.max_keys = max_keys
        self.clock = clock
        self._billable: OrderedDict[Hashable, int] = OrderedDict()
        self._blocked: OrderedDict[Hashable, int] = OrderedDict()

    def allow_billable(self, org_id: str, ip: str) -> bool:
        return self._take(self._billable, (org_id, ip, int(self.clock() // 60)), self.billable_per_ip_per_minute)

    def allow_blocked(self, org_id: str) -> bool:
        return self._take(self._blocked, (org_id, int(self.clock() // 3600)), self.blocked_per_org_per_hour)

    def _take(self, store: "OrderedDict[Hashable, int]", key: Hashable, limit: int) -> bool:
        count = store.get(key, 0)
        if count >= limit:
            return False
        store[key] = count + 1
        store.move_to_end(key)
        while len(store) > self.max_keys:
            store.popitem(last=False)
        return True
