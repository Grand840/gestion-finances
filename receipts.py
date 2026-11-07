"""Private, reproducible PDF receipts from immutable repayment snapshots."""

import base64
from io import BytesIO
from pathlib import Path
from decimal import Decimal
from xml.sax.saxutils import escape

from reportlab.lib.utils import ImageReader
from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    Image,
    Flowable,
    KeepTogether,
    HRFlowable,
)

FONT_DIR = Path(rl_config.__file__).parent / "fonts"
pdfmetrics.registerFont(TTFont("Sillage", str(FONT_DIR / "Vera.ttf")))
pdfmetrics.registerFont(TTFont("Sillage-Bold", str(FONT_DIR / "VeraBd.ttf")))
GREEN = colors.HexColor("#174f42")
MUTED = colors.HexColor("#74867e")
LIGHT = colors.HexColor("#edf4ee")


def amount(value, currency):
    return (
        f"{Decimal(str(value)):,.2f}".replace(",", " ").replace(".", ",")
        + " "
        + currency
    )


def para(value, size=10, color="#263f34", bold=False, align=0):
    return Paragraph(
        escape(str(value)).replace("\n", "<br/>"),
        ParagraphStyle(
            "cell",
            fontName="Sillage-Bold" if bold else "Sillage",
            fontSize=size,
            leading=size * 1.55,
            textColor=colors.HexColor(color),
            alignment=align,
        ),
    )


class Stamp(Flowable):
    """Issuer document stamp, with a contextual legend and registration date."""

    def __init__(self, date, label="REÇU DE REMBOURSEMENT"):
        super().__init__()
        self.width = self.height = 140
        self.date, self.label = date, label

    def draw(self):
        c = self.canv
        c.saveState()
        c.translate(70, 70)
        c.rotate(-7)
        c.setStrokeColor(GREEN)
        c.setFillColor(GREEN)
        c.setLineWidth(1.7)
        c.circle(0, 0, 62)
        c.setLineWidth(0.5)
        c.circle(0, 0, 56)
        c.setFont("Sillage-Bold", 14)
        c.drawCentredString(0, 24, "SILLAGE")
        c.setLineWidth(0.6)
        c.line(-37, 15, 37, 15)
        words = self.label.split()
        lines = []
        line = ""
        for word in words:
            if len(line + " " + word) > 20:
                lines.append(line)
                line = word
            else:
                line = (line + " " + word).strip()
        lines.append(line)
        c.setFont("Sillage-Bold", 7)
        for i, line in enumerate(lines):
            c.drawCentredString(0, 2 - i * 11, line)
        c.setFont("Sillage", 8)
        c.drawCentredString(0, -28, self.date)
        c.setFont("Sillage", 6)
        c.drawCentredString(0, -40, "ÉMIS ET ENREGISTRÉ")
        c.restoreState()


class SignatureBox(Flowable):
    def __init__(self, data, width, height):
        super().__init__()
        self.data = data
        self.width = width
        self.height = height

    def draw(self):
        if self.data:
            image = ImageReader(BytesIO(base64.b64decode(self.data)))
            w, h = image.getSize()
            scale = min(self.width / w, self.height / h)
            self.canv.drawImage(
                image,
                0,
                (self.height - h * scale) / 2,
                width=w * scale,
                height=h * scale,
                mask="auto",
            )
        else:
            self.canv.saveState()
            self.canv.setFont("Sillage", 7)
            self.canv.setFillColor(MUTED)
            self.canv.drawString(0, self.height / 2, "Signature non configurée")
            self.canv.restoreState()


def signature_image(data, width=126, height=48):
    return SignatureBox(data, width, height)


def seal_caption(snapshot):
    seal = snapshot.get("seal")
    if not seal:
        return "Archive · Empreinte des données enregistrées"
    return (
        "Scellé Ed25519 · Clé "
        + seal["key_fingerprint"][:20]
        + " · "
        + seal["issued_at"][:19].replace("T", " à ")
        + " UTC"
    )


def build_pdf(r):
    stream = BytesIO()
    doc = SimpleDocTemplate(
        stream,
        pagesize=(210 * mm, 297 * mm),
        rightMargin=21 * mm,
        leftMargin=21 * mm,
        topMargin=18 * mm,
        bottomMargin=28 * mm,
        title=r["receipt_no"],
        author=r["issuer_name"],
    )
    width = 168 * mm

    def table(data, widths=None, background=None):
        t = Table(data, colWidths=widths, hAlign="LEFT")
        styles = [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 13),
            ("RIGHTPADDING", (0, 0), (-1, -1), 13),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]
        if background:
            styles.append(("BACKGROUND", (0, 0), (-1, -1), background))
        t.setStyle(TableStyle(styles))
        return t

    currency = r["currency"]
    logo = Image(
        str(Path(__file__).parent / "public/icons/icon-192.png"), width=38, height=38
    )
    head = table(
        [
            [
                logo,
                [
                    para("Sillage", 19, bold=True),
                    para("VOS FINANCES, EN CLAIR", 6, "#74867e"),
                ],
                para("DOCUMENT DE GESTION\n" + r["receipt_no"], 8),
            ]
        ],
        [52, width - 230, 178],
    )
    story = [
        head,
        Spacer(1, 15),
        para(
            (
                "REÇU DE REMBOURSEMENT"
                if r["loan_type"] == "borrowed"
                else "QUITTANCE DE REMBOURSEMENT"
            ),
            18,
            bold=True,
        ),
        Spacer(1, 5),
        para("Prêt / emprunt : " + r["loan_title"], 10),
        Spacer(1, 5),
        para(
            "Émis le " + r["date"] + " · Versement n° " + str(r["installment_number"]),
            9,
            "#74867e",
        ),
        Spacer(1, 15),
    ]
    story += [
        table(
            [
                [
                    para("MONTANT VERSÉ", 9, "#d7eadc"),
                    para("RESTE À REMBOURSER", 9, "#d7eadc"),
                ],
                [
                    para(
                        amount(r["amount"], currency),
                        21 if len(amount(r["amount"], currency)) < 22 else 15,
                        "#ffffff",
                        True,
                    ),
                    para(
                        amount(r["remaining_balance_after"], currency),
                        (
                            21
                            if len(amount(r["remaining_balance_after"], currency)) < 22
                            else 15
                        ),
                        "#ffffff",
                        True,
                    ),
                ],
            ],
            [width / 2] * 2,
            GREEN,
        ),
        Spacer(1, 17),
    ]
    paid_by = r["issuer_name"] if r["loan_type"] == "borrowed" else r["contact_name"]
    received_by = (
        r["contact_name"] if r["loan_type"] == "borrowed" else r["issuer_name"]
    )
    story += [
        table(
            [
                [para("VERSÉ PAR", 8, "#74867e"), para("REÇU PAR", 8, "#74867e")],
                [para(paid_by, 11, bold=True), para(received_by, 11, bold=True)],
            ],
            [width / 2] * 2,
            LIGHT,
        ),
        Spacer(1, 15),
    ]
    details = [
        ["Montant initial de l’engagement", amount(r["initial_amount"], currency)],
        ["Solde avant ce versement", amount(r["remaining_balance_before"], currency)],
        ["Cumul remboursé après versement", amount(r["total_paid"], currency)],
        ["Compte de règlement", r["account_name"]],
        [
            "État après versement",
            (
                "Soldé intégralement"
                if Decimal(r["remaining_balance_after"]) == 0
                else "Remboursement partiel"
            ),
        ],
    ]
    t = table(
        [[para(a, 9, "#74867e"), para(b, 10, bold=True)] for a, b in details],
        [width * 0.53, width * 0.47],
    )
    t.setStyle(
        TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#e4ebe5"))])
    )
    story += [t, Spacer(1, 12)]
    if r.get("notes"):
        story += [
            para("MOTIF / OBSERVATIONS", 8, "#74867e", True),
            Spacer(1, 5),
            para(r["notes"], 9),
            Spacer(1, 14),
        ]
    if r.get("signature_reissued"):
        story += [
            para(
                "Réédition avec la signature actuelle de l’émetteur.",
                7,
                "#74867e",
            ),
            Spacer(1, 6),
        ]
    signatures = table(
        [
            [
                [
                    para("Signature de la partie versante", 8, "#74867e"),
                    (
                        signature_image(r.get("signature_png"))
                        if r["loan_type"] == "borrowed"
                        else Spacer(1, 40)
                    ),
                    HRFlowable(
                        width="100%", thickness=0.5, color=colors.HexColor("#cbd9c9")
                    ),
                    para("Lu et approuvé", 7, "#74867e"),
                ],
                Stamp(
                    r["date"],
                    (
                        "QUITTANCE DE PRÊT"
                        if r["loan_type"] == "given"
                        else "REÇU D’EMPRUNT"
                    ),
                ),
                [
                    para("Signature du bénéficiaire", 8, "#74867e"),
                    (
                        signature_image(r.get("signature_png"))
                        if r["loan_type"] == "given"
                        else Spacer(1, 40)
                    ),
                    HRFlowable(
                        width="100%", thickness=0.5, color=colors.HexColor("#cbd9c9")
                    ),
                    para("Pour acquit", 7, "#74867e"),
                ],
            ]
        ],
        [width * 0.32, width * 0.36, width * 0.32],
    )
    story += [
        KeepTogether(
            [
                signatures,
                Spacer(1, 8),
                para(
                    "Versement enregistré dans le dossier « " + r["loan_title"] + " ».",
                    7,
                    "#74867e",
                ),
            ]
        )
    ]

    def footer(c, d):
        c.saveState()
        c.setStrokeColor(colors.HexColor("#dce6de"))
        c.line(21 * mm, 18 * mm, 189 * mm, 18 * mm)
        c.setFont("Sillage", 7)
        c.setFillColor(MUTED)
        c.drawString(21 * mm, 14 * mm, "SHA-256 · " + r["document_hash"])
        c.drawString(21 * mm, 22 * mm, seal_caption(r))
        c.drawString(
            21 * mm,
            10 * mm,
            "Sillage · " + r["receipt_no"],
        )
        c.drawRightString(189 * mm, 10 * mm, "Page " + str(d.page))
        c.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()


def build_report(r):
    def compact(value, size=8, color="#263f34", bold=False, align=0):
        paragraph = para(value, size, color, bold, align)
        paragraph.style.leading = size * 1.3
        return paragraph

    stream = BytesIO()
    width = 174 * mm
    doc = SimpleDocTemplate(
        stream,
        pagesize=(210 * mm, 297 * mm),
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=14 * mm,
        bottomMargin=25 * mm,
        title=r["reference"],
        author=r["issuer_name"],
    )
    logo = Image(
        str(Path(__file__).parent / "public/icons/icon-192.png"), width=32, height=32
    )
    brand = Table(
        [
            [
                logo,
                [
                    compact("Sillage", 19, bold=True),
                    compact("VOS FINANCES, EN CLAIR", 6, "#74867e"),
                ],
            ]
        ],
        colWidths=[44, width - 44],
    )
    brand.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story = [
        brand,
        Spacer(1, 10),
        compact(r["title"], 17, bold=True),
        compact(r["subject"], 11),
        compact(
            r["reference"]
            + " · Émis le "
            + r["date"]
            + " · Montants en "
            + r["currency"],
            7,
            "#74867e",
        ),
        Spacer(1, 9),
    ]
    facts = [compact(label + " : " + value, 8) for label, value in r["facts"]]
    if len(facts) % 2:
        facts.append(compact("", 8))
    info = Table(
        [facts[i : i + 2] for i in range(0, len(facts), 2)], colWidths=[width / 2] * 2
    )
    info.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.extend([info, Spacer(1, 10)])
    totals = Table(
        [
            [compact(label, 7, "#d7eadc", True) for label, value in r["summary"]],
            [
                compact(
                    amount(value, r["currency"]),
                    10 if len(amount(value, r["currency"])) < 20 else 8,
                    "#ffffff",
                    True,
                )
                for label, value in r["summary"]
            ],
        ],
        colWidths=[width / len(r["summary"])] * len(r["summary"]),
    )
    totals.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), GREEN),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(totals)
    if r.get("notes"):
        story.extend(
            [
                Spacer(1, 10),
                compact("OBSERVATIONS", 8, bold=True),
                compact(r["notes"], 9),
            ]
        )
    for section in r["sections"]:
        story.extend(
            [Spacer(1, 12), compact(section["title"], 10, bold=True), Spacer(1, 6)]
        )
        n = len(section["columns"])
        widths = (
            [0.15, 0.42, 0.16, 0.11, 0.16]
            if n == 5
            else (
                [0.16, 0.30, 0.20, 0.34]
                if section["title"].startswith("Historique exhaustif")
                else [0.16, 0.44, 0.20, 0.20]
            )
        )
        data = [[compact(label, 7, "#ffffff", True) for label in section["columns"]]]
        for row in section["rows"]:
            data.append(
                [
                    compact(
                        (
                            amount(value, "").strip()
                            if i in section["money_columns"]
                            else value
                        ),
                        7,
                    )
                    for i, value in enumerate(row)
                ]
            )
        if len(data) == 1:
            data.append(
                [compact("Aucune opération", 8)]
                + [compact("", 8) for _ in range(n - 1)]
            )
        t = Table(
            data,
            colWidths=[width * x for x in widths],
            repeatRows=1,
            hAlign="LEFT",
            splitInRow=1,
        )
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), GREEN),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#dce6de")),
                ]
            )
        )
        story.append(t)
    sign = Table(
        [
            [
                [
                    compact("Émis par " + r["issuer_name"], 9, bold=True),
                    Spacer(1, 8),
                    signature_image(r.get("signature_png"), 170, 58),
                    compact("Signature de l’émetteur", 7, "#74867e"),
                ],
                Stamp(r["date"], r["stamp"]),
            ]
        ],
        colWidths=[width - 150, 150],
    )
    sign.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story.append(
        KeepTogether(
            [
                Spacer(1, 18),
                sign,
                compact(
                    "Situation arrêtée à la date d’émission.",
                    7,
                    "#74867e",
                ),
            ]
        )
    )

    def footer(c, d):
        c.saveState()
        c.setFont("Sillage", 7)
        c.setFillColor(MUTED)
        c.drawString(18 * mm, 20 * mm, seal_caption(r))
        c.drawString(18 * mm, 16 * mm, "SHA-256 · " + r["document_hash"])
        c.drawString(
            18 * mm,
            12 * mm,
            "Sillage · " + r["reference"],
        )
        c.drawRightString(192 * mm, 12 * mm, "Page " + str(d.page))
        c.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()
