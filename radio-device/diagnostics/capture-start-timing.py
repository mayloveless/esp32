"""Capture safe startup/lifecycle diagnostics until explicitly stopped.

No board reset and no fixed collection window: hardware acceptance can span
multiple chat turns. SIGINT/SIGTERM flush the file and release the serial port.
"""
import argparse
import fcntl
import os
from pathlib import Path
import re
import select
import signal
import termios
import time

parser = argparse.ArgumentParser()
parser.add_argument('--port', default='/dev/cu.usbserial-14140')
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
keep_running = True


def stop(signum, frame):
    global keep_running
    keep_running = False


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
prefixes = ('[start]', '[seek]', '[fast]', '[caption]', '[display]',
            'signalKind:', 'startOffsetMs:', 'audio stream:', 'audio playback',
            'audio failure flags:', 'completed request', 'manifest prefetch',
            'dial locked:', 'fast wav start', 'fallback to legacy seek',
            'static ', 'local static', 'encoder feedback', 'dial stopped:',
            'dial travel threshold:', 'tune request queued', 'no_signal',
            'tune response JSON/result failed', 'tuning feedback', 'manifest prepared;')
fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
exclusive = False
try:
    fcntl.ioctl(fd, termios.TIOCEXCL, 0)
    exclusive = True
    attrs = termios.tcgetattr(fd)
    attrs[0] = attrs[1] = attrs[3] = 0
    attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    attrs[4] = attrs[5] = termios.B115200
    attrs[6][termios.VMIN] = attrs[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    started = time.monotonic()
    pending = b''
    with args.output.open('a', buffering=1) as log:
        log.write('# capture opened; no reset\n')
        print('Serial capture active; stop with SIGINT/SIGTERM.', flush=True)
        while keep_running:
            if not select.select([fd], [], [], 1)[0]:
                continue
            try:
                data = os.read(fd, 4096)
            except BlockingIOError:
                continue
            if not data:
                raise RuntimeError('Serial device disconnected')
            pending += data
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                text = line.decode('utf-8', errors='replace').strip()
                transport_error = re.search(r'\[E\].*\[(?:ssl_client|NetworkClientSecure|NetworkClient|NetworkManager)\.cpp:', text)
                if text.startswith(prefixes) or transport_error:
                    if text.startswith('audio stream:'):
                        # Older firmware prints signed object paths here.
                        # Keep only the authority for firmware A/B captures.
                        value = text[len('audio stream:'):].strip()
                        value = re.sub(r'^https?://', '', value)
                        authority = re.split(r'[/\s?#]', value, maxsplit=1)[0]
                        text = 'audio stream: ' + (authority if re.fullmatch(r'[A-Za-z0-9.-]+(?::[0-9]+)?', authority) else '[redacted]')
                    if transport_error and ('http://' in text or 'https://' in text):
                        continue  # No URL paths, even when an SDK message changes.
                    # Defense in depth: no URL query may enter saved evidence.
                    text = re.sub(r'(https?://[^\s?]+)\?\S+', r'\1?[redacted]', text)
                    log.write(f'[{time.monotonic() - started:9.3f} s] {text}\n')
                elif re.search(r'Guru Meditation|assert failed|RingBuffer.*error|abort\(\)', text, re.I):
                    log.write(f'[{time.monotonic() - started:9.3f} s] [fatal] library crash/assert/buffer error\n')
            if len(pending) > 16384:
                pending = b''  # Bound corrupt or unterminated serial output.
        log.write('# capture closed\n')
finally:
    if exclusive:
        fcntl.ioctl(fd, termios.TIOCNXCL, 0)
    os.close(fd)
