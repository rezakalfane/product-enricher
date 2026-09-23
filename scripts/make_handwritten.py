"""
Render a photographed handwritten note onto lined paper, for testing the OCR + vision path.
The content describes a real product in the channel that is missing these attributes.

Run: ./.venv-fixtures/bin/python scripts/make_handwritten.py
"""
import math, pathlib, random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

random.seed(7)
OUT = pathlib.Path("fixtures/docs"); OUT.mkdir(parents=True, exist_ok=True)
FONT = "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf"

W, H = 1500, 2000
MARGIN_X, TOP = 150, 170
LINE_H = 74

LINES = [
    ("Buyer's note - 22 Sept", 46, "head"),
    ("", 0, "body"),
    ("Geek Vape Aegis Boost Vape III Kit", 44, "head"),
    ("(the one on the end cap)", 34, "small"),
    ("", 0, "body"),
    ("Battery: 1000 mAh built in", 38, "body"),
    ("Output: 5 - 25 W", 38, "body"),
    ("Pod: 3.5ml refillable, top fill", 38, "body"),
    ("Coils: B series, 0.4 + 0.6 ohm", 38, "body"),
    ("Charging: USB-C  1A", 38, "body"),
    ("Waterproof rating IP68", 38, "body"),
    ("Colours in stock: Black, Navy,", 38, "body"),
    ("   Gunmetal, Rainbow", 38, "body"),
    ("", 0, "body"),
    ("Warranty 12 months", 38, "body"),
    ("Trade price stays GBP 20.23", 38, "body"),
    ("", 0, "body"),
    ("*** none of this is on the", 36, "note"),
    ("     listing yet - please add!", 36, "note"),
]


def paper() -> Image.Image:
    """Off-white sheet with faint grain, ruled lines and a margin rule."""
    img = Image.new("RGB", (W, H), (252, 251, 246))
    grain = Image.effect_noise((W, H), 14).convert("L").point(lambda v: 255 - (255 - v) // 9)
    img = Image.composite(img, Image.new("RGB", (W, H), (238, 236, 229)), grain)

    d = ImageDraw.Draw(img)
    for y in range(TOP - 24, H - 90, LINE_H):
        d.line([(90, y), (W - 80, y)], fill=(206, 214, 226), width=2)
    d.line([(MARGIN_X - 34, 60), (MARGIN_X - 34, H - 60)], fill=(228, 176, 176), width=3)
    return img


def ink(kind: str) -> tuple[int, int, int]:
    base = {"head": (22, 32, 78), "small": (70, 78, 110),
            "body": (28, 40, 92), "note": (150, 34, 40)}[kind]
    return tuple(max(0, min(255, c + random.randint(-12, 12))) for c in base)


def write(img: Image.Image) -> Image.Image:
    """Draw each line character by character with baseline and spacing jitter."""
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    y = TOP

    for text, size, kind in LINES:
        if not text:
            y += LINE_H // 2
            continue
        font = ImageFont.truetype(FONT, size)
        x = MARGIN_X + random.randint(-5, 5)
        colour = ink(kind)
        for ch in text:
            d.text(
                (x, y + random.uniform(-2.5, 2.5)),
                ch,
                font=font,
                fill=colour + (random.randint(225, 255),),
            )
            x += d.textlength(ch, font=font) + random.uniform(-0.6, 1.4)
        if kind == "head":
            # Underline the headings with a slightly wobbly stroke.
            d.line([(MARGIN_X, y + size + 8), (x, y + size + 11)], fill=colour + (200,), width=3)
        y += LINE_H

    layer = layer.filter(ImageFilter.GaussianBlur(0.5))
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    return img


def photograph(img: Image.Image) -> Image.Image:
    """Slight rotation, an uneven lighting gradient and a touch of softness."""
    img = img.rotate(-1.1, resample=Image.BICUBIC, expand=False, fillcolor=(250, 249, 244))

    shade = Image.new("L", (W, H))
    sd = ImageDraw.Draw(shade)
    for y in range(H):
        for_x = int(238 - 26 * math.sin(math.pi * y / H))
        sd.line([(0, y), (W, y)], fill=for_x)
    img = Image.composite(img, Image.new("RGB", (W, H), (208, 205, 196)), shade)

    return img.filter(ImageFilter.GaussianBlur(0.4))


out = OUT / "handwritten-buyer-note.jpg"
photograph(write(paper())).save(out, "JPEG", quality=88)
print("  ✓", out)
