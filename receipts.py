"""Private, reproducible PDF receipts from immutable repayment snapshots."""

from io import BytesIO
from pathlib import Path
from decimal import Decimal
from xml.sax.saxutils import escape

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
    width = 115
    height = 115

    def __init__(self, date):
        super().__init__()
        self.width = self.height = 115
        self.date = date

    def draw(self):
        c = self.canv
        c.saveState()
        c.translate(57, 57)
        c.rotate(-10)
        c.setStrokeColor(GREEN)
        c.setFillColor(GREEN)
        c.setLineWidth(1.4)
        c.circle(0, 0, 49)
        c.setLineWidth(0.45)
        c.circle(0, 0, 44)
        c.setFont("Sillage-Bold", 11)
        c.drawCentredString(0, 18, "SILLAGE")
        c.setFont("Sillage", 7)
        c.drawCentredString(0, 3, "VERSEMENT ENREGISTRÉ")
        c.setFont("Sillage-Bold", 9)
        c.drawCentredString(0, -12, self.date)
        c.setFont("Sillage", 6)
        c.drawCentredString(0, -27, "CACHET APPLICATIF")
        c.restoreState()


def build_pdf(r):
    stream = BytesIO()
    doc = SimpleDocTemplate(
        stream,
        pagesize=(210 * mm, 297 * mm),
        rightMargin=21 * mm,
        leftMargin=21 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title=r["receipt_no"],
        author="Sillage",
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
                para("DOCUMENT PERSONNEL\n" + r["receipt_no"], 8),
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
    signatures = table(
        [
            [
                [
                    para("Signature de la partie versante", 8, "#74867e"),
                    Spacer(1, 35),
                    HRFlowable(
                        width="100%", thickness=0.5, color=colors.HexColor("#cbd9c9")
                    ),
                    para("Lu et approuvé", 7, "#74867e"),
                ],
                Stamp(r["date"]),
                [
                    para("Signature du bénéficiaire", 8, "#74867e"),
                    Spacer(1, 35),
                    HRFlowable(
                        width="100%", thickness=0.5, color=colors.HexColor("#cbd9c9")
                    ),
                    para("Pour acquit", 7, "#74867e"),
                ],
            ]
        ],
        [width * 0.33, width * 0.34, width * 0.33],
    )
    story += [
        KeepTogether(
            [
                signatures,
                Spacer(1, 8),
                para(
                    "Le cachet Sillage atteste uniquement l’enregistrement dans l’application. Ce document ne vaut ni certification bancaire ni signature des parties.",
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
        c.setFont("Sillage", 6)
        c.setFillColor(MUTED)
        c.drawString(
            21 * mm, 14 * mm, "Empreinte des données (SHA-256) : " + r["document_hash"]
        )
        c.drawString(
            21 * mm,
            10 * mm,
            "Sillage · Exemplaire personnel · Référence " + r["receipt_no"],
        )
        c.drawRightString(189 * mm, 10 * mm, "Page " + str(d.page))
        c.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()
