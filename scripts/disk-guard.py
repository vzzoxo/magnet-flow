#!/usr/bin/env python3
"""Pause all aria2 downloads when free disk space on DOWNLOAD_DIR drops below a
threshold, so downloads can't fill the disk. Run from cron every few minutes.

Env: DOWNLOAD_DIR, MIN_FREE_GB, ARIA2_CONF, ARIA2_RPC, DISK_GUARD_LOG
Does NOT auto-resume — once you free space, resume from the UI.
"""
import json, os, re, shutil, time, urllib.request

DOWNLOAD_DIR = os.environ.get("DOWNLOAD_DIR", "/root/downloads")
MIN_FREE_GB = float(os.environ.get("MIN_FREE_GB", "2"))
CONF = os.environ.get("ARIA2_CONF", "/root/.aria2/aria2.conf")
RPC = os.environ.get("ARIA2_RPC", "http://127.0.0.1:6800/jsonrpc")
LOG = os.environ.get("DISK_GUARD_LOG", "/root/.aria2/disk-guard.log")


def log(msg):
    try:
        open(LOG, "a", encoding="utf-8").write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except OSError:
        pass


def main():
    try:
        free_gb = shutil.disk_usage(DOWNLOAD_DIR).free / (1024 ** 3)
    except OSError as e:
        log(f"disk check failed: {e}")
        return 1
    if free_gb >= MIN_FREE_GB:
        return 0

    secret = ""
    try:
        m = re.search(r"^rpc-secret=(.*)$", open(CONF, encoding="utf-8").read(), flags=re.M)
        secret = m.group(1) if m else ""
    except OSError:
        pass

    body = json.dumps({
        "jsonrpc": "2.0", "id": "diskguard",
        "method": "aria2.pauseAll", "params": ["token:" + secret],
    }).encode()
    try:
        urllib.request.urlopen(
            urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"}),
            timeout=15,
        )
        log(f"LOW DISK {free_gb:.2f}GB < {MIN_FREE_GB:.2f}GB on {DOWNLOAD_DIR} -> paused all downloads")
    except Exception as e:
        log(f"LOW DISK {free_gb:.2f}GB but pauseAll failed: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
