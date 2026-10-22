"""Private App Server supervisor. fd 3: control; fd 4: evidence, never model text."""
import ctypes
import json
import os
import select
import signal
import subprocess
import sys
import time

stopping = False


def stop(_signal=None, _frame=None):
    global stopping
    stopping = True


def report(state):
    os.write(4, (json.dumps({"state": state}) + "\n").encode())


try:
    # Adopt double-forked/session-detached descendants, including after root exit.
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise OSError("subreaper unavailable")
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    root = subprocess.Popen(sys.argv[1:], stdin=0, stdout=1, stderr=2, close_fds=True)
    report("ready")
    while not stopping and root.poll() is None:
        readable, _, _ = select.select([3], [], [], 0.05)
        if readable:
            os.read(3, 4096)
            stop()
    # Kill only direct children. Orphans become direct children of this subreaper.
    # Reaping to ECHILD proves that no owned descendants remain; zombies are reaped.
    while True:
        children = open(f"/proc/self/task/{os.getpid()}/children").read().split()
        for child in children:
            try:
                os.kill(int(child), signal.SIGKILL)
            except ProcessLookupError:
                pass
        try:
            while os.waitpid(-1, os.WNOHANG)[0]:
                pass
        except ChildProcessError:
            report("interrupted")
            break
        time.sleep(0.01)
except Exception:
    # No positive evidence is sent if containment or cleanup could not be proven.
    try:
        report("unknown")
    except OSError:
        pass
    sys.exit(1)
