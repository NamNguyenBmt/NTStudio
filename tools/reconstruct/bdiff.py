# Byte-level line diff of two files (shows \r explicitly). Usage: python bdiff.py a b [max]
import sys, difflib
a = open(sys.argv[1], "rb").read().split(b"\n")
b = open(sys.argv[2], "rb").read().split(b"\n")
mx = int(sys.argv[3]) if len(sys.argv) > 3 else 40
n = 0
for l in difflib.unified_diff([repr(x)[2:-1] for x in a], [repr(x)[2:-1] for x in b], lineterm="", n=1):
    sys.stdout.buffer.write((l[:170] + "\n").encode("utf8"))
    n += 1
    if n > mx: break
