#!/usr/bin/env python
"""
fill_forms.py — overlays collected WhatsApp answers onto the real Soledd
paper form templates, producing a filled PDF that mirrors the original
layout (not a generic summary).

Usage:
    python scripts/fill_forms.py <category_code> <payload.json> <output.pdf>

category_code: SSB | GOVT_PENSIONER | SME | PRIVATE_SECTOR
payload.json:  { "answers": <extraDetails>, "application": {...clean DB
               fields}, "computed": <loanCalculator result, or null> }
"""

import io
import json
import re
import sys
import textwrap

import pdfplumber
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black

from pdf_layout_utils import find_label_bbox, find_option_near

FORMS_DIR = "assets/forms"

FONT = "Helvetica"
FONT_SIZE = 9


def wrap_text(text, width_chars=95):
    return textwrap.wrap(str(text), width=width_chars) or [""]


# ─── Splitting "all in one" answers into their parts ──────────────────────
# The WhatsApp flow asks for e.g. phone + address in one message; the paper
# form has a separate box for each. These parse the combined answer so each
# piece lands in the right box.

_PHONE_RE = re.compile(r"(?<![\d/])(?:\+?263|0)[\s\-]?\d(?:[\s\-]?\d){7,11}(?![\d/])")
_ACCT_KEYWORD_RE = re.compile(r"(?:a\s*/\s*c|acc(?:ount|t)?|no\.?)\s*[:.#]?\s*([0-9][0-9\s\-]{3,})", re.I)
_LONG_DIGITS_RE = re.compile(r"\b(\d{6,20})\b")
_DOB_RE = re.compile(r"\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b")


def _clean_num(s):
    return re.sub(r"[^\d+]", "", s or "")


def _tidy(s):
    s = re.sub(r"\s+", " ", (s or "")).strip(" ,;:-\n\t")
    s = re.sub(r"(?:,\s*){2,}", ", ", s)
    return s.strip(" ,;:-")


def split_contact(text):
    """'0772 111 222, 5 Willow Close, Harare' -> (phone1, phone2, address)."""
    text = str(text or "")
    phones = [m.group(0) for m in _PHONE_RE.finditer(text)]
    rest = text
    for p in phones:
        rest = rest.replace(p, " ", 1)
    nums = [_clean_num(p) for p in phones]
    p1 = nums[0] if nums else ""
    p2 = nums[1] if len(nums) > 1 else ""
    return p1, p2, _tidy(rest)


def split_bank(text):
    """'CBZ Bank, account 1234567890' -> (bank_name, account_number)."""
    text = _tidy(text)
    if not text:
        return "", ""
    m = _ACCT_KEYWORD_RE.search(text)
    if not m:
        m = _LONG_DIGITS_RE.search(text)
        if m:
            name = _tidy(text[: m.start()] + " " + text[m.end():])
            return name, m.group(1)
        return text, ""
    acct = re.sub(r"[\s\-]", "", m.group(1))
    name = _tidy(text[: m.start()])
    # strip a trailing "branch ..." clause from the name if present
    name = re.split(r"\bbranch\b", name, flags=re.I)[0]
    return _tidy(name), acct


def split_personal(text):
    """'17/12/1994, 5 Rd Harare, 0782 000 111' -> (dob, address, phone)."""
    text = str(text or "")
    dob = ""
    m = _DOB_RE.search(text)
    if m:
        dob = m.group(1)
        text = text.replace(dob, " ", 1)
    p1, _p2, addr = split_contact(text)
    return dob, addr, p1


class FormFiller:
    def __init__(self, template_path):
        self.template_path = template_path
        self.pdf = pdfplumber.open(template_path)
        self.page_height = self.pdf.pages[0].height
        self.page_width = self.pdf.pages[0].width
        self.overlays = {}  # page_index -> list of draw ops

    def _page(self, page_index):
        return self.pdf.pages[page_index]

    def _add(self, page_index, x, y, text, size=FONT_SIZE):
        self.overlays.setdefault(page_index, []).append((x, y, text, size))

    def text_right(self, page_index, label, value, occurrence=0, dx=8, dy=-3):
        try:
            bbox = find_label_bbox(self._page(page_index), label, occurrence)
        except ValueError:
            print(f"[WARN] label not found (text_right): {label!r} on page {page_index}", file=sys.stderr)
            return
        x = bbox["x1"] + dx
        y = self.page_height - bbox["bottom"] - dy
        self._add(page_index, x, y, str(value))

    def text_below(self, page_index, label, value, occurrence=0, dx=0, dy=14, width_chars=95, max_lines=3):
        try:
            bbox = find_label_bbox(self._page(page_index), label, occurrence)
        except ValueError:
            print(f"[WARN] label not found (text_below): {label!r} on page {page_index}", file=sys.stderr)
            return
        x = bbox["x0"] + dx
        y0 = self.page_height - bbox["bottom"] - dy
        for i, line in enumerate(wrap_text(value, width_chars)[:max_lines]):
            self._add(page_index, x, y0 - i * 11, line)

    def text_in_box(self, page_index, box, value, size=FONT_SIZE, x_pad=4, y_pad=5, max_lines=2, width_chars=None):
        """Draws `value` inside an explicit box rect `(x0, x1, top, bot)`
        (pdfplumber-style top/bot from the page top), top-aligned, wrapped."""
        if value is None or str(value).strip() == "":
            return
        x0, x1, top, bot = box
        avail = max(20, (x1 - x0) - 2 * x_pad)
        if width_chars is None:
            width_chars = max(6, int(avail / (size * 0.5)))
        lines = wrap_text(value, width_chars)[:max_lines]
        line_h = size + 2.5
        y0 = self.page_height - top - size - y_pad
        for i, line in enumerate(lines):
            self._add(page_index, x0 + x_pad, y0 - i * line_h, line, size=size)

    def mark_box(self, page_index, box, mark="X", size=10):
        """Puts a mark roughly centred in an explicit box rect."""
        x0, x1, top, bot = box
        self._add(page_index, (x0 + x1) / 2 - size * 0.3, self.page_height - bot + (bot - top - size) / 2 + 1, mark, size=size)

    def text_in_box_below(self, page_index, label, value, occurrence=0, size=FONT_SIZE, x_pad=5, y_pad=5):
        """Places `value` inside the ruled box that sits directly below
        `label` (the deduction forms lay every field out that way). Falls
        back to a plain line just under the label if no box is found."""
        if value is None or str(value) == "":
            return
        try:
            lb = find_label_bbox(self._page(page_index), label, occurrence)
        except ValueError:
            print(f"[WARN] label not found (box_below): {label!r} on page {page_index}", file=sys.stderr)
            return
        page = self._page(page_index)
        # The input box directly under the label: starts within ~32pt below
        # it, left edge roughly aligned, any width.
        cands = [
            r for r in page.rects
            if lb["bottom"] - 3 <= r["top"] <= lb["bottom"] + 32
            and r["x0"] <= lb["x0"] + 45
            and r["x1"] > lb["x0"]
            and 8 < (r["bottom"] - r["top"]) < 70
        ]
        if cands:
            box = min(cands, key=lambda r: (r["top"], abs(r["x0"] - lb["x0"])))
            x = box["x0"] + x_pad
            y = self.page_height - box["bottom"] + y_pad
        else:
            x = lb["x0"] + x_pad
            y = self.page_height - lb["bottom"] - 12
        self._add(page_index, x, y, str(value), size=size)

    def text_row(self, page_index, x, row_top, row_bottom, text, size=7):
        """Places text inside a table cell whose PDF-space rect (row_top,
        row_bottom, both measured from the page top, pdfplumber-style) is
        already known — used for the Financial Schedule grid, where each
        cell's own "label" is a multi-line column header rather than a
        single phrase text_below/text_right can anchor to. Anchored near the
        top of the cell, not centered — the row is tall enough to visually
        collide with the section below it if centered."""
        y = self.page_height - row_top - size - 1
        self._add(page_index, x, y, str(text), size=size)

    def mark_choice(self, page_index, question_label, option_text, occurrence=0, dx=8):
        try:
            bbox = find_option_near(self._page(page_index), question_label, option_text, occurrence)
        except ValueError:
            print(f"[WARN] option not found: {option_text!r} near {question_label!r}", file=sys.stderr)
            return
        # Tick-box follows its label in these forms (e.g. "Mr. [ ]", "YES [ ]").
        x = bbox["x1"] + dx
        y = self.page_height - bbox["bottom"] + 1
        self._add(page_index, x, y, "X", size=10)

    def save(self, output_path):
        reader = PdfReader(self.template_path)
        writer = PdfWriter()

        for i, page in enumerate(reader.pages):
            ops = self.overlays.get(i, [])
            if ops:
                buf = io.BytesIO()
                c = canvas.Canvas(buf, pagesize=(self.page_width, self.page_height))
                c.setFillColor(black)
                for (x, y, text, size) in ops:
                    c.setFont(FONT, size)
                    c.drawString(x, y, text)
                c.save()
                buf.seek(0)
                overlay_reader = PdfReader(buf)
                page.merge_page(overlay_reader.pages[0])
            writer.add_page(page)

        with open(output_path, "wb") as f:
            writer.write(f)
        self.pdf.close()


# ─── Field resolution, tolerant of both the current combined-question
# schema (nameLine, contactLine, bankDetails — see applicationQuestions.js)
# and the older granular schema some existing applications were captured
# with (title/firstNames/surname, phone/residentialAddress, bankName/
# bankAccount). Falls back to the application's own DB columns last, since
# those always exist regardless of which schema extra_details used.

def _first_nonempty(answers, keys):
    for k in keys:
        v = answers.get(k)
        if v:
            return v
    return ""


# Titles we recognise at the front of a combined name line. Order matters
# only for display; matching is on the whole first token.
_TITLES = {
    "mr": "Mr.", "mrs": "Mrs.", "ms": "Ms.", "miss": "Miss",
    "dr": "Dr.", "prof": "Prof.", "rev": "Rev.",
}


def split_name(name_line):
    """'Mrs Michelle Chinodya' -> ('Mrs.', 'Michelle', 'Chinodya').

    Returns (title, first_names, surname). Any part may be '' — a bare
    single word becomes the first name, an unrecognised leading word is kept
    as part of the first names (not dropped)."""
    tokens = str(name_line or "").strip().split()
    if not tokens:
        return "", "", ""

    title = ""
    first_token = tokens[0].lower().rstrip(".")
    if first_token in _TITLES:
        title = _TITLES[first_token]
        tokens = tokens[1:]

    if not tokens:
        return title, "", ""
    if len(tokens) == 1:
        return title, tokens[0], ""

    return title, " ".join(tokens[:-1]), tokens[-1]


def tick_title(f, page_index, anchor_label, title):
    """Ticks the Mr./Mrs./Ms./Miss box on a form, anchored to `anchor_label`.
    Exact match on the normalised title, so 'Mrs' never also ticks 'Mr'."""
    box = {"Mr.": "Mr.", "Mrs.": "Mrs.", "Ms.": "Ms.", "Miss": "Miss"}.get(title)
    if box:
        f.mark_choice(page_index, anchor_label, box)


def resolve_full_name(answers, application):
    """Combined 'Mr Tinashe Moyo' style — for forms where First Names holds the whole name."""
    combined = _first_nonempty(answers, ["nameLine"])
    if combined:
        return combined
    parts = [answers.get("title", ""), answers.get("firstNames", ""), answers.get("surname", "")]
    combined = " ".join(p for p in parts if p).strip()
    if combined:
        return combined
    return application.get("fullName", "") or ""


def resolve_first_names(answers, application):
    """Title + first name only — for forms with a separate Surname box (SME)."""
    if answers.get("nameLine"):
        return answers["nameLine"]
    parts = [answers.get("title", ""), answers.get("firstNames", "")]
    combined = " ".join(p for p in parts if p).strip()
    if combined:
        return combined
    full = application.get("fullName", "") or ""
    surname = resolve_surname(answers, application)
    if full and surname and full.endswith(surname):
        return full[: -len(surname)].strip()
    return full


def resolve_surname(answers, application):
    return answers.get("surname") or application.get("employerName", "") or ""


def resolve_national_id(answers, application):
    return _first_nonempty(answers, ["nationalId"]) or application.get("nationalId", "") or ""


def resolve_contact(answers):
    combined = _first_nonempty(answers, ["contactLine", "personalDetails"])
    if combined:
        return combined
    parts = [answers.get("phone", ""), answers.get("residentialAddress", "")]
    return ", ".join(p for p in parts if p)


def resolve_bank(answers):
    combined = _first_nonempty(answers, ["bankDetails"])
    if combined:
        return combined
    name, acct = answers.get("bankName", ""), answers.get("bankAccount", "")
    parts = [p for p in [name, f"Account {acct}" if acct else ""] if p]
    return ", ".join(parts)


# Column x-positions (PDF points) for the government form's Financial
# Schedule table, and the blank data row's top/bottom — both hand-measured
# from the template via pdfplumber (see scripts/pdf_layout_utils.py's
# docstring for why: this table has no per-cell label to anchor to, just a
# shared multi-line column header row, so text_below/text_right don't fit).
GOVERNMENT_SCHEDULE_ROW = (387.2, 413.6)
GOVERNMENT_SCHEDULE_COLUMNS = {
    "loan_amount": 37, "collection_commission": 95, "establishment_fee": 148,
    "interest_rate": 214, "immt_tax": 272, "bank_charge": 321,
    "loan_protection": 384, "instalment_amount": 449, "num_instalments": 517,
}


def fill_government_schedule(f, page_index, application, computed):
    if not computed:
        return
    row_top, row_bottom = GOVERNMENT_SCHEDULE_ROW
    cols = GOVERNMENT_SCHEDULE_COLUMNS

    def put(key, text):
        f.text_row(page_index, cols[key], row_top, row_bottom, text)

    put("loan_amount", f"${float(application.get('loanAmount') or 0):.2f}")
    put("collection_commission", f"${computed['collectionFee']:.2f}")
    put("establishment_fee", f"${computed['upfrontCharges']['establishment']:.2f}")
    put("interest_rate", f"{computed['monthlyRatePct']}%")
    put("immt_tax", f"${computed['upfrontCharges']['immt']:.2f}")
    put("bank_charge", f"${computed['upfrontCharges']['bankCharge']:.2f}")
    put("loan_protection", f"${computed['upfrontCharges']['loanProtection']:.2f}")
    put("instalment_amount", f"${computed['totalMonthlyInstalment']:.2f}")
    put("num_instalments", str(computed["tenorMonths"]))


# government_agreement.pdf — every input box hand-measured from the template
# (595 x 842). Each is (x0, x1, top, bot) in pdfplumber page-top coordinates.
GOV_BOX = {
    "first_names": (285, 560, 71, 93),
    "id":          (47, 201, 107, 126),
    "surname":     (285, 560, 108, 129),
    "telephone":   (106, 197, 136, 151),
    "mobile":      (285, 375, 137, 152),
    "residential": (111, 560, 165, 202),
    "next_of_kin": (114, 560, 216, 252),
    "bank_name":   (317, 441, 299, 326),
    "account_no":  (444, 560, 299, 326),
    "purpose":     (121, 560, 437, 455),
    "title_mr":    (46, 67, 83, 96),
    "title_mrs":   (110, 131, 82, 95),
    "title_other": (184, 206, 86, 99),
}


def fill_government(payload, output_path):
    answers = payload.get("answers", {})
    application = payload.get("application", {})
    computed = payload.get("computed")
    f = FormFiller(f"{FORMS_DIR}/government_agreement.pdf")

    # Name: split into title tick + First Names + Surname boxes.
    title, first_names, surname = split_name(resolve_full_name(answers, application))
    tbox = {"Mr.": "title_mr", "Mrs.": "title_mrs"}.get(title, "title_other" if title else None)
    if tbox:
        f.mark_box(0, GOV_BOX[tbox])
    f.text_in_box(0, GOV_BOX["first_names"], first_names, size=10, max_lines=1)
    f.text_in_box(0, GOV_BOX["surname"], surname, size=10, max_lines=1)
    f.text_in_box(0, GOV_BOX["id"], resolve_national_id(answers, application), size=9, max_lines=1)

    # contactLine = "phone + residential address" — split it: phone(s) to the
    # Telephone / Mobile boxes, the rest to Residential Address.
    combined = _first_nonempty(answers, ["contactLine", "personalDetails"])
    p1, p2, addr = split_contact(combined)
    db_phone = application.get("applicantPhone", "")
    f.text_in_box(0, GOV_BOX["telephone"], p1 or db_phone, size=9, max_lines=1)
    f.text_in_box(0, GOV_BOX["mobile"], p2 or (db_phone if not p1 else ""), size=9, max_lines=1)
    f.text_in_box(0, GOV_BOX["residential"], addr or resolve_contact(answers), size=9, max_lines=3)

    f.text_in_box(0, GOV_BOX["next_of_kin"], answers.get("nextOfKin", ""), size=9, max_lines=3)

    # bankDetails = "bank name + account number" — split into the two cells.
    bank_name, acct = split_bank(resolve_bank(answers))
    f.text_in_box(0, GOV_BOX["bank_name"], bank_name, size=9, max_lines=2)
    f.text_in_box(0, GOV_BOX["account_no"], acct, size=9, max_lines=1)

    # The blank template already has "Monthly Salary" ticked, so only mark a
    # box when the applicant chose something else.
    src = (answers.get("sourceOfIncome", "") or "").lower()
    for opt in ["Remittances from Diaspora", "Sale of Asset", "Other"]:
        if opt.lower() in src or (src and src in opt.lower()):
            f.text_right(0, opt, "X", dx=16, dy=-1)
            break

    f.text_in_box(0, GOV_BOX["purpose"], answers.get("purposeOfLoan", ""), size=9, max_lines=1)

    fill_government_schedule(f, 0, application, computed)

    f.save(output_path)


def fill_sme(payload, output_path):
    answers = payload.get("answers", {})
    application = payload.get("application", {})
    f = FormFiller(f"{FORMS_DIR}/sme_application.pdf")

    # nameLine here is just "Mr Chipo" (title + first name only) — surname /
    # registered company name stays its own question since it also feeds the
    # employer_name database column.
    title, first_names, _ = split_name(resolve_first_names(answers, application))
    tick_title(f, 0, "First Names", title)
    f.text_right(0, "First Names", first_names or resolve_first_names(answers, application))
    f.text_below(0, "Surname/Registered", resolve_surname(answers, application), dy=14, occurrence=0)
    f.text_right(0, "ID", resolve_national_id(answers, application), dx=65)
    f.text_below(0, "Residential address of Applicant and business address", answers.get("address", ""), dy=16, width_chars=90)
    f.text_below(0, "employer and attach payslip and bank statement.", answers.get("repaymentSource", ""), dy=16, width_chars=90)
    f.text_below(0, "Name, Address and phone of the next of kin", answers.get("nextOfKin", ""), dy=16, width_chars=90)

    # These five are single-line questions stacked tightly — answer goes to
    # the right of each, not below (no room between consecutive questions).
    f.text_right(0, "Experience?", answers.get("qualifications", ""), dx=10)
    f.text_right(0, "Nature of business?", answers.get("natureOfBusiness", ""), dx=10)
    f.text_right(0, "in this industry?", answers.get("yearsInIndustry", ""), dx=10)
    f.text_right(0, "this obligation?", answers.get("securityPledged", ""), dx=10)
    f.text_right(0, "your debts?", answers.get("blacklisted", ""), dx=10)

    # bankDetails ("bank name, branch, account") goes into the Name of Bank box.
    f.text_below(0, "Name of Bank", resolve_bank(answers), dy=20, width_chars=60)

    f.text_below(0, "Purpose of loan) Attach all necessary documentation)", answers.get("purposeOfLoan", ""), dy=16, width_chars=90)
    f.text_below(0, "How many times have you successfully done this transaction? Please provide details", answers.get("transactionHistory", ""), dy=16, width_chars=90)

    loan_amount = application.get("loanAmount")
    if loan_amount:
        f.text_below(0, "Loan required", f"${float(loan_amount):.2f}", dy=14, width_chars=20)
        f.text_below(0, "Currency", "USD", dy=14, width_chars=10)

    f.save(output_path)


def fill_private_sector(payload, output_path):
    answers = payload.get("answers", {})
    application = payload.get("application", {})
    computed = payload.get("computed")
    f = FormFiller(f"{FORMS_DIR}/private_sector_application.pdf")

    # Page 0 — Personal / Next of Kin / Family / Budget / Facility
    # nameLine ("Mr Tapiwa Ncube") is split into the title tick-box, First
    # Names and Surname. personalDetails ("dob, address, contact") goes into
    # the larger Physical Address box — see applicationQuestions.js.
    title, first_names, surname = split_name(resolve_full_name(answers, application))
    # This form has "Mr /Mrs/Ms/Miss /Other ......" as a fill-in line, not
    # tick-boxes — write the title (no trailing dot) onto the line after it.
    if title:
        f.text_right(0, "Miss", title.rstrip("."), dx=34)
    f.text_right(0, "First Names", first_names)
    f.text_right(0, "Surname", surname, dx=8)
    f.text_right(0, "ID / Passport No.", resolve_national_id(answers, application))

    # personalDetails = "date of birth + physical address + contact number" —
    # the form has a separate field for each.
    dob, addr, contact = split_personal(answers.get("personalDetails", ""))
    if dob:
        f.text_right(0, "D.O.B", dob, dx=8)
    f.text_below(0, "Physical Address", addr or answers.get("personalDetails") or resolve_contact(answers), dy=14, occurrence=0, width_chars=60)
    f.text_below(0, "Contact Details", contact or application.get("applicantPhone", ""), dy=13, width_chars=50)

    # nextOfKin = "full name, address, phone, relationship" — name on the
    # Full names line, the rest into the next-of-kin Physical Address line.
    nok = answers.get("nextOfKin", "")
    nok_name, _sep, nok_rest = nok.partition(",")
    f.text_right(0, "Full names", (nok_name.strip() or nok), dx=8)
    if nok_rest.strip():
        f.text_below(0, "Physical Address", nok_rest.strip(), dy=13, occurrence=1, width_chars=60)

    f.text_right(0, "Marital", answers.get("maritalStatus", ""), dx=40)
    spouse = answers.get("spouseDetails")
    if spouse:
        f.text_below(0, "Full name of your Spouse", spouse, dy=14, width_chars=60)
    children = answers.get("childrenDetails", "")
    if children:
        f.text_below(0, "Which school do your children attend ?", children, dy=14, width_chars=90)

    budget = answers.get("monthlyBudget", "")
    if budget:
        f.text_below(0, "Please share your monthly budget with us", budget, dy=14, width_chars=90)

    f.text_right(0, "Loan", answers.get("loanAmount", ""), dx=20, occurrence=1)
    period = answers.get("repaymentMonths")
    if period:
        f.mark_choice(0, "Repayment", str(period))
    if computed:
        # Rounded input box, not a plain rect — text_below's label-relative
        # offset landed outside it; the box's own coordinates are exact.
        f.text_row(0, 341, 655.2, 670.5, f"${computed['totalMonthlyInstalment']:.2f}", size=9)

    purpose = answers.get("purposeOfLoan", "")
    purpose_map = {
        "working capital": "Working Capital", "asset finance": "Asset",
        "inputs finance": "Inputs", "solar asset finance": "Solar", "other": "Other",
    }
    key = purpose.lower()
    if key in purpose_map:
        f.mark_choice(0, "Purpose of Loan", purpose_map[key])

    purchase = answers.get("purchaseDetails", "")
    if purchase:
        f.text_below(0, "Attach all necessary", purchase, dy=20, width_chars=40)

    # Page 1 — Employment/Business, Income, Asset, Banking
    employed = answers.get("formallyEmployed")
    if employed == "YES":
        f.mark_choice(1, "Are you formally employed", "YES")
        f.text_right(1, "If YES, Name of the Employer", answers.get("employerName", ""))
        f.text_right(1, "Permanent", answers.get("employmentDuration", ""), dx=40)
        f.text_right(1, "What is your Employer Address", answers.get("employerAddress", ""))
    else:
        f.mark_choice(1, "Are you formally employed", "NO")
        # These four questions are stacked tightly (no room between rows) —
        # answers go to the right of each label, not below.
        f.text_right(1, "If No, What is your sources of income", answers.get("incomeSources", ""), dx=10)
        f.text_right(1, "Where do you operate from", answers.get("businessOperation", ""), dx=10)
        f.text_right(1, "Who are your major clients ?", answers.get("majorClients", ""), dx=10)

    f.text_right(1, "What is your take home monthly income?", answers.get("takeHomeIncome", ""))
    deposit = answers.get("hasDeposit")
    if deposit:
        f.mark_choice(1, "Do you have the 30% deposit required?", "YES" if deposit == "YES" else "NO")
    depsrc = answers.get("depositSource", "")
    depsrc_map = {"savings": "Savings", "diaspora": "Diaspora", "income from work": "Income", "other": "Other"}
    if depsrc.lower() in depsrc_map:
        f.mark_choice(1, "What is the source of the deposit?", depsrc_map[depsrc.lower()])

    vehicle = answers.get("ownVehicle")
    if vehicle:
        f.mark_choice(1, "Do you own a motor vehicle", vehicle)
    prop = answers.get("ownProperty")
    if prop:
        f.mark_choice(1, "Do you own a fixed property", prop)
    method = answers.get("propertyPurchaseMethod", "")
    method_map = {"mortgage": "Mortgage", "savings": "Savings", "income": "Income", "other": "Other"}
    if method.lower() in method_map:
        f.mark_choice(1, "How did you purchase the fixed property", method_map[method.lower()])

    f.text_below(1, "Who owns the property where the asset or equipment is to be installed", answers.get("assetPropertyOwner", ""), dy=9, width_chars=60)
    f.text_right(1, "Who are your bankers?", answers.get("bankersDetails", ""))
    banks_income = answers.get("banksIncome")
    if banks_income:
        f.mark_choice(1, "Do you bank your income?", banks_income)

    # Page 2 — Borrowing details / declarations
    borrowed = answers.get("borrowedBefore")
    if borrowed:
        f.mark_choice(2, "Have you ever borrowed money before from a financial institution in the last 12", borrowed)
    lender = answers.get("lenderDetails", "")
    if lender:
        f.text_below(2, "If yes, please provide details of the lender", lender, dy=14, width_chars=90)

    blacklisted = answers.get("blacklisted")
    if blacklisted:
        f.mark_choice(2, "Have you ever been blacklisted or had a court judgement against you in the last 12", blacklisted)

    understand_obl = answers.get("understandObligations")
    if understand_obl:
        f.mark_choice(2, "Do you understand your monthly obligations if the loan is approved? Have they been fully explained to you?", understand_obl)

    understand_def = answers.get("understandDefault")
    if understand_def:
        f.mark_choice(2, "Do you understand the consequences of default?", understand_def)

    plan = answers.get("defaultPlan", "")
    if plan:
        f.text_below(2, "If you default, what other plan do you have to settle the debt?", plan, dy=14, width_chars=90)

    f.save(output_path)


# ─── Salary / pension deduction ("stop order") forms ──────────────────────
# All three share the same field set; only the template and the loan-account
# label differ. Sent to the applicant alongside the loan agreement at the end
# of the WhatsApp application so they can print, sign and send them back.
DEDUCTION_FORMS = {
    "DEDUCTION_SSB": {
        "template": "ssb_deduction_form.pdf",
        "account_label": "SOLEDD LOAN ACCOUNT NUMBER",
        "has_employment_code": True,
    },
    "DEDUCTION_PENSIONS": {
        "template": "pensions_deduction_form.pdf",
        "account_label": "REFERENCE NUMBER",
        "has_employment_code": False,
    },
    "DEDUCTION_PRIVATE": {
        "template": "private_deduction_form.pdf",
        "account_label": "SOLEDD LOAN ACCOUNT NUMBER",
        "has_employment_code": True,
    },
}


def fill_deduction_form(kind, payload, output_path):
    cfg = DEDUCTION_FORMS[kind]
    answers = payload.get("answers", {})
    application = payload.get("application", {})
    computed = payload.get("computed") or {}
    f = FormFiller(f"{FORMS_DIR}/{cfg['template']}")

    # Every field on these forms is "label, then a ruled box just below it".
    _, first_names, surname = split_name(resolve_full_name(answers, application))
    f.text_in_box_below(0, "SURNAME", surname)
    f.text_in_box_below(0, "FIRST NAME", first_names)
    if cfg["has_employment_code"]:
        f.text_in_box_below(0, "EMPLOYMENT CODE NUMBER", answers.get("employmentCode", ""))

    # Mark NEW — this is always a fresh deduction instruction. The tick box
    # sits a little to the right of the word.
    f.text_right(0, "NEW", "X", dx=22, dy=1)

    monthly = computed.get("totalMonthlyInstalment")
    if monthly is not None:
        f.text_in_box_below(0, "MONTHLY AMOUNT", f"${float(monthly):.2f}")
    tenor = computed.get("tenorMonths") or application.get("repaymentMonths")
    if tenor:
        f.text_in_box_below(0, "NUMBER OF DEDUCTIONS", str(tenor))
    if computed.get("firstRepaymentDate"):
        f.text_in_box_below(0, "START DATE", str(computed["firstRepaymentDate"]))
    if computed.get("finalRepaymentDate"):
        f.text_in_box_below(0, "END DATE", str(computed["finalRepaymentDate"]))

    acct = application.get("lmsLoanNumber") or application.get("referenceNumber") or ""
    f.text_in_box_below(0, cfg["account_label"], acct)
    f.text_in_box_below(0, "NATIONAL ID NUMBER", resolve_national_id(answers, application))

    f.save(output_path)


CATEGORY_FILLERS = {
    "SSB": fill_government,
    "GOVT_PENSIONER": fill_government,
    "SME": fill_sme,
    "PRIVATE_SECTOR": fill_private_sector,
}


def main():
    if len(sys.argv) != 4:
        print("Usage: python fill_forms.py <category_code> <answers.json> <output.pdf>", file=sys.stderr)
        sys.exit(1)

    category_code, payload_path, output_path = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(payload_path, encoding="utf-8") as f:
        payload = json.load(f)

    if category_code in DEDUCTION_FORMS:
        fill_deduction_form(category_code, payload, output_path)
        print(output_path)
        return

    filler = CATEGORY_FILLERS.get(category_code)
    if not filler:
        print(f"Unknown category: {category_code}", file=sys.stderr)
        sys.exit(1)

    filler(payload, output_path)
    print(output_path)


if __name__ == "__main__":
    main()
