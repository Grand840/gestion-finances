"""Conservative image preparation: original handwriting, no invented strokes."""

from io import BytesIO
from PIL import Image, ImageChops, ImageOps, UnidentifiedImageError


def normalize_signature(binary):
    if len(binary) > 524288:
        raise ValueError("Image trop volumineuse")
    image = Image.open(BytesIO(binary))
    if image.format not in ("PNG", "JPEG") or image.width * image.height > 4000000:
        raise ValueError("Format ou dimensions invalides")
    image.load()
    image = ImageOps.exif_transpose(image).convert("RGBA")
    # Composite on white before extracting ink: hidden RGB values in transparent
    # pixels must never become visible. Retain coloured ink and original geometry.
    white = Image.new("RGBA", image.size, "white")
    white.alpha_composite(image)
    rgb = white.convert("RGB")
    difference = ImageChops.difference(rgb, Image.new("RGB", rgb.size, "white"))
    ink = difference.convert("L").point(lambda v: 255 if v > 40 else 0)
    box = ink.getbbox()
    if box is None:
        raise ValueError("L’image ne contient pas de signature visible")
    image = rgb.crop(box).convert("RGBA")
    # Remove only neutral near-white paper; don't recolour or redraw the ink.
    pixels = []
    for red, green, blue, _ in image.get_flattened_data():
        if (
            min(red, green, blue) >= 220
            and max(red, green, blue) - min(red, green, blue) < 20
        ):
            pixels.append((red, green, blue, 0))
        else:
            pixels.append((red, green, blue, 255))
    image.putdata(pixels)
    image.thumbnail((860, 260), Image.Resampling.LANCZOS)
    output = Image.new(
        "RGBA", (image.width + 32, image.height + 24), (255, 255, 255, 0)
    )
    output.alpha_composite(image, (16, 12))
    stream = BytesIO()
    output.save(stream, format="PNG", optimize=True)
    result = stream.getvalue()
    if len(result) > 131072:
        raise ValueError("Image normalisée trop volumineuse")
    return result


IMAGE_ERRORS = (
    UnidentifiedImageError,
    ValueError,
    OSError,
    Image.DecompressionBombError,
)
