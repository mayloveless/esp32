"""Summarize only real prefetch-hit first-PCM samples; never print source log lines."""
import argparse
import json
from pathlib import Path
import re
import statistics

parser = argparse.ArgumentParser()
parser.add_argument('logs', nargs='+', type=Path)
args = parser.parse_args()
records = []
pattern = re.compile(r'\[start\] summary: mode=(legacy|fast) prefetch=(\d) fallback=(\d) tls=(\d+) headerMs=(\d+) rangeMs=(\d+) totalMs=(\d+)')
for log in args.logs:
    for line in log.read_text(errors='replace').splitlines():
        match = pattern.search(line)
        if not match:
            continue
        mode, *values = match.groups()
        hit, fallback, tls, header, target_range, total = map(int, values)
        records.append(dict(mode=mode, prefetch=bool(hit), fallback=bool(fallback), tls=tls,
                            headerMs=header, rangeMs=target_range, totalMs=total))
result = {'samples': records, 'eligible': {}, 'medianImprovementPercent': None, 'abSampleCountSatisfied': False}
for mode in ['legacy', 'fast']:
    samples = [row for row in records if row['mode'] == mode and row['prefetch'] and not row['fallback']]
    result['eligible'][mode] = {'count': len(samples), 'medianMs': statistics.median(row['totalMs'] for row in samples) if samples else None}
legacy, fast = (result['eligible'][mode] for mode in ['legacy', 'fast'])
if legacy['count'] and fast['count']:
    result['medianImprovementPercent'] = round(100 * (1 - fast['medianMs'] / legacy['medianMs']), 1)
result['abSampleCountSatisfied'] = legacy['count'] >= 3 and fast['count'] >= 5
print(json.dumps(result, ensure_ascii=False, indent=2))
