# So ảnh chụp A/B (mỗi bên nhiều lần chụp): lấy cặp lệch ít nhất để loại pha animation.
# Dùng: python pixdiff.py <thư-mục-report>
import sys, glob, os, re
from PIL import Image, ImageChops

def load(paths):
    return [Image.open(p).convert("RGB") for p in sorted(paths)]

def count(a, b):
    if a.size != b.size:
        return 10**9, None
    d = ImageChops.difference(a, b)
    box = d.getbbox()
    if not box:
        return 0, None
    return sum(1 for p in d.crop(box).get_flattened_data() if p != (0, 0, 0)), box

root = sys.argv[1]
slugs = sorted({re.sub(r"\.A\.\d+\.png$", "", os.path.basename(p)) for p in glob.glob(os.path.join(root, "*.A.*.png"))})
same = 0
for s in slugs:
    A = load(glob.glob(os.path.join(root, f"{s}.A.*.png")))
    B = load(glob.glob(os.path.join(root, f"{s}.B.*.png")))
    best = min((count(a, b) for a in A for b in B), key=lambda x: x[0])
    if best[0] == 0:
        same += 1
    else:
        print(f"{s:60s} pixels={best[0]:7d} box={best[1]}")
print(f"pixel-identical: {same}/{len(slugs)}")
