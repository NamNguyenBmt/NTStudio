# Print line ranges of a CSS file that contain CR characters (i.e. came from a CRLF source file), with a preview.
import sys
data = open(sys.argv[1], "rb").read().split(b"\n")
runs, start = [], None
for i, l in enumerate(data, 1):
    cr = l.endswith(b"\r")
    if cr and start is None: start = i
    if not cr and start is not None: runs.append((start, i - 1)); start = None
if start: runs.append((start, len(data)))
for a, b in runs:
    print(f"{a}-{b}: {data[a-1][:70]!r} ... {data[b-1][:50]!r}")
