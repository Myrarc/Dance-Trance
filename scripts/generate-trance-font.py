"""Build the original Trance Display pixel-slab font used by the game UI."""

from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

OUT = Path(__file__).resolve().parents[1] / "public" / "fonts"
UPM = 1000
CELL = 118
GAP = 18
LEFT = 45
BOTTOM = 80

PATTERNS = {
    "A": ["01110","10001","10001","11111","10001","10001","10001"],
    "B": ["11110","10001","10001","11110","10001","10001","11110"],
    "C": ["01111","10000","10000","10000","10000","10000","01111"],
    "D": ["11110","10001","10001","10001","10001","10001","11110"],
    "E": ["11111","10000","10000","11110","10000","10000","11111"],
    "F": ["11111","10000","10000","11110","10000","10000","10000"],
    "G": ["01111","10000","10000","10111","10001","10001","01111"],
    "H": ["10001","10001","10001","11111","10001","10001","10001"],
    "I": ["11111","00100","00100","00100","00100","00100","11111"],
    "J": ["00111","00010","00010","00010","10010","10010","01100"],
    "K": ["10001","10010","10100","11000","10100","10010","10001"],
    "L": ["10000","10000","10000","10000","10000","10000","11111"],
    "M": ["10001","11011","10101","10101","10001","10001","10001"],
    "N": ["10001","11001","10101","10011","10001","10001","10001"],
    "O": ["01110","10001","10001","10001","10001","10001","01110"],
    "P": ["11110","10001","10001","11110","10000","10000","10000"],
    "Q": ["01110","10001","10001","10001","10101","10010","01101"],
    "R": ["11110","10001","10001","11110","10100","10010","10001"],
    "S": ["01111","10000","10000","01110","00001","00001","11110"],
    "T": ["11111","00100","00100","00100","00100","00100","00100"],
    "U": ["10001","10001","10001","10001","10001","10001","01110"],
    "V": ["10001","10001","10001","10001","10001","01010","00100"],
    "W": ["10001","10001","10001","10101","10101","11011","10001"],
    "X": ["10001","10001","01010","00100","01010","10001","10001"],
    "Y": ["10001","10001","01010","00100","00100","00100","00100"],
    "Z": ["11111","00001","00010","00100","01000","10000","11111"],
    "0": ["01110","10001","10011","10101","11001","10001","01110"],
    "1": ["00100","01100","00100","00100","00100","00100","01110"],
    "2": ["01110","10001","00001","00010","00100","01000","11111"],
    "3": ["11110","00001","00001","01110","00001","00001","11110"],
    "4": ["00010","00110","01010","10010","11111","00010","00010"],
    "5": ["11111","10000","10000","11110","00001","00001","11110"],
    "6": ["01110","10000","10000","11110","10001","10001","01110"],
    "7": ["11111","00001","00010","00100","01000","01000","01000"],
    "8": ["01110","10001","10001","01110","10001","10001","01110"],
    "9": ["01110","10001","10001","01111","00001","00001","01110"],
    "!": ["00100","00100","00100","00100","00100","00000","00100"],
    "?": ["01110","10001","00001","00010","00100","00000","00100"],
    ".": ["00000","00000","00000","00000","00000","00100","00100"],
    ",": ["00000","00000","00000","00000","00100","00100","01000"],
    ":": ["00000","00100","00100","00000","00100","00100","00000"],
    "-": ["00000","00000","00000","11111","00000","00000","00000"],
    "+": ["00000","00100","00100","11111","00100","00100","00000"],
    "/": ["00001","00010","00010","00100","01000","01000","10000"],
    "'": ["00100","00100","00000","00000","00000","00000","00000"],
}

def glyph(pattern=None):
    pen = TTGlyphPen(None)
    if pattern:
        for row, line in enumerate(pattern):
            for col, filled in enumerate(line):
                if filled != "1":
                    continue
                x = LEFT + col * CELL
                y = BOTTOM + (6 - row) * CELL
                # Alternating shallow cut-ins make the face feel screen-printed,
                # not like a stock terminal bitmap.
                inset = 8 if (row + col) % 3 == 0 else 0
                pen.moveTo((x + inset, y))
                pen.lineTo((x + CELL - GAP, y))
                pen.lineTo((x + CELL - GAP - inset, y + CELL - GAP))
                pen.lineTo((x, y + CELL - GAP))
                pen.closePath()
    return pen.glyph()

glyph_order = [".notdef", "space"]
cmap = {32: "space"}
glyphs = {".notdef": glyph(), "space": glyph()}
metrics = {".notdef": (650, 0), "space": (330, 0)}

for char, pattern in PATTERNS.items():
    name = f"uni{ord(char):04X}"
    glyph_order.append(name)
    glyphs[name] = glyph(pattern)
    metrics[name] = (650, 0)
    cmap[ord(char)] = name

for char in "abcdefghijklmnopqrstuvwxyz":
    source = char.upper()
    name = f"uni{ord(char):04X}"
    glyph_order.append(name)
    glyphs[name] = glyph(PATTERNS[source])
    metrics[name] = (650, 0)
    cmap[ord(char)] = name

builder = FontBuilder(UPM, isTTF=True)
builder.setupGlyphOrder(glyph_order)
builder.setupCharacterMap(cmap)
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics(metrics)
builder.setupHorizontalHeader(ascent=930, descent=-120)
builder.setupOS2(
    sTypoAscender=930,
    sTypoDescender=-120,
    usWinAscent=930,
    usWinDescent=120,
    usWeightClass=800,
    usWidthClass=6,
)
builder.setupNameTable({
    "familyName": "Trance Display",
    "styleName": "Heavy",
    "uniqueFontIdentifier": "DanceTrance:TranceDisplayHeavy:1.0",
    "fullName": "Trance Display Heavy",
    "psName": "TranceDisplay-Heavy",
    "version": "Version 1.000",
})
builder.setupPost()
builder.setupMaxp()

OUT.mkdir(parents=True, exist_ok=True)
ttf = OUT / "trance-display-heavy.ttf"
builder.save(ttf)
font = builder.font
font.flavor = "woff2"
font.save(OUT / "trance-display-heavy.woff2")
print(ttf)
