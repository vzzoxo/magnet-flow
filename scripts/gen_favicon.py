#!/usr/bin/env python3
"""Generate a multi-size favicon.ico for MagnetFlow (pure stdlib).

Draws the same brand mark as logo.svg: a white horseshoe magnet with
coloured pole tips on an Apple-style gradient squircle, plus a few
"flow" particles. Uses supersampling for antialiasing, encodes each
size as PNG and packs them into a single .ico container.
"""
import struct, zlib, math

# ---- design constants (in a 0..128 design space) -------------------------
C0 = (10, 132, 255)    # #0A84FF
C1 = (94, 92, 230)     # #5E5CE6
C2 = (191, 90, 242)    # #BF5AF2
TIP_L = (10, 132, 255)
TIP_R = (191, 90, 242)

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def bg_color(x, y):
    t = (x + y) / 256.0
    if t < 0.55:
        c = lerp(C0, C1, t / 0.55)
    else:
        c = lerp(C1, C2, (t - 0.55) / 0.45)
    # top sheen -> glass highlight
    s = max(0.0, 0.22 * (1 - y / 90.0))
    return lerp(c, (255, 255, 255), s)

def in_squircle(x, y):
    x0, y0, x1, y1, r = 6, 6, 122, 122, 30
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return math.hypot(x - cx, y - cy) <= r

def magnet_side(x, y):
    """Return None / 'L' / 'R' / 'B' (body) for the horseshoe magnet."""
    dx, dy = x - 64, y - 64
    # lower annulus (the U curve)
    if dy >= 0:
        rr = math.hypot(dx, dy)
        if 9 <= rr <= 24:
            return 'B'
    left_leg = 40 <= x <= 55 and 34 <= y <= 64
    right_leg = 73 <= x <= 88 and 34 <= y <= 64
    left_cap = math.hypot(x - 47.5, y - 34) <= 7.5
    right_cap = math.hypot(x - 80.5, y - 34) <= 7.5
    if left_leg or left_cap:
        return 'L'
    if right_leg or right_cap:
        return 'R'
    return None

def magnet_color(x, y, side):
    if y <= 46 and side == 'L':
        return TIP_L
    if y <= 46 and side == 'R':
        return TIP_R
    # body: white with a faint cool tint toward the bottom
    return lerp((255, 255, 255), (228, 240, 255), max(0.0, (y - 34) / 60.0))

PARTICLES = [(100, 96, 4.5, 0.95), (110, 84, 3.0, 0.7), (106, 104, 2.2, 0.55)]

def sample(x, y):
    """Return (r,g,b,a) for a design-space point."""
    if not in_squircle(x, y):
        return (0, 0, 0, 0)
    r, g, b = bg_color(x, y)
    a = 255
    side = magnet_side(x, y)
    if side:
        r, g, b = magnet_color(x, y, side)
    for px, py, pr, op in PARTICLES:
        if math.hypot(x - px, y - py) <= pr:
            r = round(r + (255 - r) * op)
            g = round(g + (255 - g) * op)
            b = round(b + (255 - b) * op)
    return (r, g, b, a)

def render(n, ss=4):
    """Render an n x n RGBA image with ss x ss supersampling."""
    rows = []
    inv = 128.0 / n
    sub = [(k + 0.5) / ss for k in range(ss)]
    n_ss = ss * ss
    for py in range(n):
        row = bytearray()
        for px in range(n):
            ar = ag = ab = aa = 0
            for sy in sub:
                dy = (py + sy) * inv
                for sx in sub:
                    dx = (px + sx) * inv
                    r, g, b, a = sample(dx, dy)
                    # premultiply for correct edge AA
                    ar += r * a; ag += g * a; ab += b * a; aa += a
            if aa == 0:
                row += b"\x00\x00\x00\x00"
            else:
                row += bytes((ar // aa, ag // aa, ab // aa, aa // n_ss))
        rows.append(bytes(row))
    return rows

def png_bytes(n, rows):
    raw = bytearray()
    for row in rows:
        raw += b"\x00" + row            # filter type 0 per scanline
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))

def build_ico(sizes, path):
    pngs = []
    for n in sizes:
        print(f"  rendering {n}x{n} ...")
        pngs.append((n, png_bytes(n, render(n))))
    count = len(pngs)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = bytearray()
    data = bytearray()
    for n, png in pngs:
        wh = 0 if n >= 256 else n
        entries += struct.pack("<BBBBHHII", wh, wh, 0, 0, 1, 32, len(png), offset)
        data += png
        offset += len(png)
    with open(path, "wb") as f:
        f.write(header + bytes(entries) + bytes(data))
    print(f"  wrote {path} ({len(header)+len(entries)+len(data)} bytes, sizes={sizes})")

if __name__ == "__main__":
    build_ico([16, 32, 48, 256], "/root/magnet-flow/public/favicon.ico")
    # also emit a 512px PNG for PWA / og use
    with open("/root/magnet-flow/public/img/icon-512.png", "wb") as f:
        f.write(png_bytes(512, render(512, ss=2)))
    print("  wrote icon-512.png")
