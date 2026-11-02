"""Synthetic test image only. Never used as a user's default signature."""

from io import BytesIO
import sys
from PIL import Image, ImageDraw

image = Image.new("RGB", (600, 170), "white")
draw = ImageDraw.Draw(image)
draw.line(
    [(30, 110), (75, 40), (100, 125), (185, 70), (265, 90), (350, 68), (555, 80)],
    fill="#173d63",
    width=4,
)
draw.text((365, 120), "SPECIMEN - TEST", fill="#5b6873")
stream = BytesIO()
image.save(stream, format="PNG")
sys.stdout.buffer.write(stream.getvalue())
