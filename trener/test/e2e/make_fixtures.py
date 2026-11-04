#!/usr/bin/env python3
"""Vytvoří syntetické soubory pro zkoušku stránky v prohlížeči (e2e.cjs).

Všechny texty jsou napsané pro zkoušku. Nejsou z žádné skutečné knihy, takže je lze
mít v repozitáři. Skutečné knihy se do repozitáře nikdy nedávají.

Použití:  python3 trener/test/e2e/make_fixtures.py <výstupní složka> [počet stran dlouhé knihy, výchozí 24]
Potřebuje reportlab (pip install reportlab) a písmo DejaVu Sans pro češtinu v PDF.
"""
import pathlib
import struct
import sys
import zlib

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

CS_PAGES = [
    [
        "Izolovaný útočník je hráč, ke kterému se míč dostává bez blízké podpory záložníků. "
        "Když se záložní řada drží hluboko a obrana brání nízko, vzniká mezi řadami velká vzdálenost. "
        "Útočník ji sám nepřekoná a každý dlouhý míč skončí ztrátou.",
        "Zkrácení vzdálenosti mezi řadami pomáhá víc než další hráč v útoku. "
        "Záložník, který se pohybuje v týlu soupeřových záložníků, dává útočníkovi možnost odpoutat míč. "
        "Rozhodující je načasování pohybu, ne počet hráčů před míčem.",
    ],
    [
        "Vysoký presink vyžaduje kompaktní tým. Všechny řady se posouvají společně k míči, "
        "jinak soupeř vyhraje souboj a najde volný prostor za obranou. "
        "Když presink začne jen u dvou hráčů, zbytek týmu zůstane bez opory.",
        "Po ztrátě míče je prvních pět vteřin nejdůležitějších. Okamžitý protipresink brání soupeři v rychlém protiútoku. "
        "Pokud hráči nemají jistotu, že je kryjí, raději ustoupí do bloku.",
    ],
    [
        "Šířka hřiště se využívá, aby se soupeřova obrana roztáhla. Křídelník držený u lajny "
        "vytahuje obránce z prostoru před brankou a otevírá středem cestu pro přihrávku mezi obránce.",
        "Pomalé budování hry od brankáře zvyšuje počet přihrávek, ale nezaručuje lepší šance. "
        "Pro soupeře, který hraje nízký blok, je důležitější změna rytmu a rychlé otočení hry.",
    ],
]

EN_PAGES = [
    [
        "Support striker isolation is a classic problem in a lone-forward system. "
        "When midfielders sit deep, the distance between the lines grows and the forward cannot link play.",
        "A shorter distance between lines is more valuable than adding another attacker. "
        "Movement into the pocket behind the opposition midfield gives the forward a passing option.",
    ],
    [
        "Counter-pressing works only when the team stays compact after losing possession. "
        "The first five seconds decide whether the opponent can break forward or must recycle the ball.",
    ],
    [
        "Compactness between the lines limits central progression. A narrow block forces the opponent wide, "
        "where the touchline helps the defending team.",
        "Width in attack stretches the defensive line and opens passing lanes between defenders.",
    ],
    [
        "Set pieces create a large share of goals in matches between evenly matched teams. "
        "Rehearsed routines matter less than clear marking responsibilities.",
    ],
]


def write_pdf(path, pages, font, font_name=None):
    c = canvas.Canvas(str(path), pagesize=A4)
    width, height = A4
    for paragraphs in pages:
        y = height - 70
        c.setFont(font, 11)
        for paragraph in paragraphs:
            for line in simpleSplit(paragraph, font, 11, width - 120):
                c.drawString(60, y, line)
                y -= 16
            y -= 10
        c.showPage()
    c.save()


def write_long_pdf(path, pages, header="ZKUŠEBNÍ PŘÍRUČKA – ZÁHLAVÍ STRANY"):
    """Delší kniha se záhlavím a číslem na každé straně (jako skutečná kniha)."""
    import random

    rnd = random.Random(7)
    subjects = ["útočník", "záložník", "křídelník", "obránce", "brankář", "kapitán", "střední záložník", "hrot"]
    actions = ["drží pozici", "nabíhá do prostoru", "čeká na přihrávku", "vyhrává souboje", "zavírá střed", "otevírá křídlo", "couvá do bloku", "napadá soupeře"]
    reasons = ["protože soupeř hraje nízký blok", "když tým ztratí míč", "pokud se řady oddálí", "při rychlém přechodu", "ve vlastní třetině", "po standardní situaci", "při náskoku v zápase"]
    c = canvas.Canvas(str(path), pagesize=A4)
    width, height = A4
    for number in range(1, pages + 1):
        c.setFont("DejaVu", 9)
        c.drawString(60, height - 40, header)
        c.drawRightString(width - 60, 30, str(number))
        c.setFont("DejaVu", 11)
        y = height - 80
        paragraph = " ".join(
            f"{rnd.choice(subjects).capitalize()} {rnd.choice(actions)}, {rnd.choice(reasons)}." for _ in range(18)
        )
        for line in simpleSplit(paragraph, "DejaVu", 11, width - 120):
            if y < 60:
                break
            c.drawString(60, y, line)
            y -= 15
        c.showPage()
    c.save()


def write_scan_pdf(path):
    c = canvas.Canvas(str(path), pagesize=A4)
    for _ in range(2):
        c.rect(60, 100, 400, 500, fill=1)  # jen obrazec, žádný text
        c.showPage()
    c.save()


def write_png(path, size=48):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            row += bytes(((x * 5) % 256, (y * 5) % 256, 140))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    pathlib.Path(path).write_bytes(png)


def main():
    out = pathlib.Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))

    sections = ["\n\n".join(p) for p in CS_PAGES]
    (out / "taktika-cs.txt").write_text("\n\n\n".join(sections) + "\n", encoding="utf-8")
    write_pdf(out / "taktika-cs.pdf", CS_PAGES, "DejaVu")
    write_pdf(out / "tactics-en.pdf", EN_PAGES, "Helvetica")
    write_scan_pdf(out / "sken.pdf")
    big = int(sys.argv[2]) if len(sys.argv) > 2 else 24
    write_long_pdf(out / "kniha-s-zahlavim.pdf", big)
    write_png(out / "screenshot.png")
    (out / "prazdny.txt").write_text("   \n", encoding="utf-8")
    print("hotovo:", ", ".join(sorted(p.name for p in out.iterdir())))


if __name__ == "__main__":
    main()
