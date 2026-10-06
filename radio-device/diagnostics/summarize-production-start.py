"""Summarize a fresh hardware capture; do not reuse 011A acceptance samples."""
import argparse
import json
from pathlib import Path
import re
import statistics


def summarize(text, exclude_startup=False):
    records, fatal = [], 0
    current = None
    for line in text.splitlines():
        if '[fatal]' in line:
            fatal += 1
        match = re.search(r'\[start\] dial.locked: ms=0 prefetch=([01])', line)
        if match:
            if current and not current['eofCount']:
                current['manualInterruption'] = True
            current = dict(selection=len(records) + 1, prefetch=bool(int(match[1])),
                           kind=None, startOffsetMs=None, mode=None, fallback=False,
                           eofCount=0, completedSuccessCount=0, failed=False,
                           manualInterruption=False, firstCaptionMs=None,
                           fallbackReasons=[])
            records.append(current)
        if current is None:
            continue
        match = re.search(r'signalKind: (\w+)', line)
        if match:
            current['kind'] = match[1]
        match = re.search(r'startOffsetMs: (\d+)', line)
        if match:
            current['startOffsetMs'] = int(match[1])
        match = re.search(r'\[start\] tls.connected: ms=(\d+)', line)
        if match:
            current['tlsReadyMs'] = int(match[1])
        match = re.search(r'\[start\] summary: mode=(legacy|fast) prefetch=([01]) fallback=([01]) tls=(\d+) headerMs=(\d+) rangeMs=(\d+) totalMs=(\d+)', line)
        if match:
            mode, hit, fallback, tls, header, target, total = match.groups()
            current.update(mode=mode, prefetch=bool(int(hit)), fallback=bool(int(fallback)),
                           tls=int(tls), headerMs=int(header), rangeMs=int(target), totalMs=int(total))
        if 'fallback to legacy seek' in line:
            current['fallback'] = True
        match = re.search(r'fast wav start failed: ([A-Za-z /]+)', line)
        if match:
            current['fallbackReasons'].append(match[1].strip())
        match = re.search(r'\[caption\] index=.* playbackMs=(\d+)', line)
        if match and current['firstCaptionMs'] is None:
            current['firstCaptionMs'] = int(match[1])
        current['eofCount'] += int('audio playback completed' in line)
        current['completedSuccessCount'] += int('completed request succeeded' in line)
        if 'audio playback failed' in line or 'completed request failed' in line:
            current['failed'] = True

    observations = records[1:] if exclude_startup else records
    successes = [r for r in observations if r['mode'] == 'fast' and not r['fallback'] and 'totalMs' in r]
    hit_values = [r['totalMs'] for r in successes if r['prefetch']]
    fallback_count = sum(r['fallback'] for r in observations)
    finished_attempts = len(successes) + fallback_count + sum(r['failed'] and not r['fallback'] for r in observations)
    eof_successes = sum(r['eofCount'] == r['completedSuccessCount'] == 1 and not r['failed'] for r in observations)
    kinds = sorted({r['kind'] for r in successes if r['kind']})
    median = statistics.median(hit_values) if hit_values else None
    initial_phases = [r['headerMs'] - r['tlsReadyMs'] for r in successes if 'tlsReadyMs' in r and 'headerMs' in r]
    checks = dict(selections=len(observations) >= 8, prefetchHits=sum(r['prefetch'] for r in observations) >= 6,
                  fastSuccesses=len(successes) >= 6, allKinds=set(kinds) >= {'news', 'chat', 'alien', 'music'},
                  twoNaturalCompleted=eof_successes >= 2,
                  offsetAtLeast10s=any((r['startOffsetMs'] or 0) >= 10000 for r in successes),
                  captions=any(r['firstCaptionMs'] is not None for r in successes),
                  noFailures=not fatal and not any(r['failed'] for r in records),
                  onceOnlyCompleted=all(r['eofCount'] <= 1 and r['completedSuccessCount'] <= 1 and
                                        not (r['manualInterruption'] and r['eofCount']) for r in observations),
                  captionClock=all(r['firstCaptionMs'] is None or r['startOffsetMs'] is not None and
                                   r['firstCaptionMs'] >= (r['startOffsetMs'] // 1000) * 1000 for r in observations),
                  successRate=bool(finished_attempts) and len(successes) / finished_attempts >= .85,
                  medianTarget=median is not None and median <= 3500)
    return dict(samples=records, startupExcluded=exclude_startup, physicalSelectionCount=len(observations), fastSuccessCount=len(successes), fallbackCount=fallback_count,
                fastSuccessRatePercent=round(100 * len(successes) / finished_attempts, 1) if finished_attempts else None,
                prefetchFastCount=len(hit_values), prefetchFastMedianMs=median,
                slowestPrefetchFastMs=max(hit_values) if hit_values else None,
                slowestFastSuccessMs=max(r['totalMs'] for r in successes) if successes else None,
                naturalCompletedCount=eof_successes, initialResponseMedianMs=statistics.median(initial_phases) if initial_phases else None, fatalCount=fatal, checks=checks,
                numericalChecksPassed=all(checks.values()),
                physicalRapidRotationAndListeningRequireUserConfirmation=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('log', type=Path)
    parser.add_argument('--exclude-startup', action='store_true', help='Exclude the first selection after an upload/reset')
    args = parser.parse_args()
    print(json.dumps(summarize(args.log.read_text(errors='replace'), args.exclude_startup), ensure_ascii=False, indent=2))
