#!/usr/bin/env python3
"""Fetch the latest BT tracker list, persist it to aria2.conf and hot-update a
running aria2 via JSON-RPC. Intended to run from cron (see install.sh).

Env overrides: TRACKER_URL, ARIA2_CONF, ARIA2_RPC, ARIA2_LOG
"""
import json, os, re, sys, time, urllib.request

URL = os.environ.get("TRACKER_URL", "https://raw.githubusercontent.com/adysec/tracker/main/trackers_best.txt")
CONF = os.environ.get("ARIA2_CONF", "/root/.aria2/aria2.conf")
RPC = os.environ.get("ARIA2_RPC", "http://127.0.0.1:6800/jsonrpc")
LOG = os.environ.get("ARIA2_LOG", "/root/.aria2/update-trackers.log")


def log(msg):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n"
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass
    print(line, end="")


def main():
    try:
        raw = urllib.request.urlopen(URL, timeout=60).read().decode("utf-8", "ignore")
    except Exception as e:
        log(f"fetch failed: {e}")
        return 1

    trackers = [l.strip() for l in raw.splitlines() if re.match(r"^[a-z]+://", l.strip())]
    if not trackers:
        log("fetched empty list, aborting")
        return 1
    line = ",".join(trackers)

    # Persist into aria2.conf
    try:
        conf = open(CONF, encoding="utf-8").read()
        if re.search(r"^bt-tracker=", conf, flags=re.M):
            conf = re.sub(r"^bt-tracker=.*$", "bt-tracker=" + line, conf, count=1, flags=re.M)
        else:
            conf = conf.rstrip() + "\nbt-tracker=" + line + "\n"
        open(CONF, "w", encoding="utf-8").write(conf)
        secret_m = re.search(r"^rpc-secret=(.*)$", conf, flags=re.M)
        secret = secret_m.group(1) if secret_m else ""
    except OSError as e:
        log(f"conf update failed: {e}")
        return 1

    # Hot-update the running aria2 (best effort)
    try:
        body = json.dumps({
            "jsonrpc": "2.0", "id": "cron",
            "method": "aria2.changeGlobalOption",
            "params": ["token:" + secret, {"bt-tracker": line}],
        }).encode()
        req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"})
        res = urllib.request.urlopen(req, timeout=20).read().decode()
        log(f"updated {len(trackers)} trackers (conf + live); rpc={res[:80]}")
    except Exception as e:
        log(f"updated {len(trackers)} trackers in conf; live hot-update failed (will apply on next aria2 restart): {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
