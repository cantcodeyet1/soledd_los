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


def fill_government(payload, output_path):
    answers = payload.get("answers", {})
    application = payload.get("application", {})
    computed = payload.get("computed")
    f = FormFiller(f"{FORMS_DIR}/government_agreement.pdf")

    # nameLine holds the combined "Mrs Michelle Chinodya" answer — split it
    # into the title tick-box, the First Names box, and the Surname box.
    title, first_names, surname = split_name(resolve_full_name(answers, application))
    tick_title(f, 0, "First Names", title)
    f.text_right(0, "First Names", first_names)
    f.text_right(0, "Surname", surname, dx=8)

    f.text_right(0, "ID", resolve_national_id(answers, application), dx=30)

    # Placed by the input box's own rect, not text_right off the label — the
    # label sits above a bordered box here rather than beside a fill line, so
    # a label-relative offset either clips the box top or sits on its
    # underline; the box coordinates themselves (hand-measured) are exact.
    phone = application.get("applicantPhone", "")
    if phone:
        f.text_row(0, 109, 135.3, 152.1, phone, size=9)
        f.text_row(0, 287, 136.2, 153.0, phone, size=9)

    # contactLine ("phone, address") goes into the larger Residential Address box.
    f.text_below(0, "Residential Address", resolve_contact(answers), dy=14, width_chars=60)
    f.text_below(0, "Name, Address and phone", answers.get("nextOfKin", ""), dy=10, width_chars=60)

    # bankDetails ("bank name, account number") goes into the Name of Bank box.
    f.text_below(0, "Name of Bank", resolve_bank(answers), dy=30, width_chars=40)

    src = answers.get("sourceOfIncome", "")
    for opt in ["Monthly Salary", "Remittances from Diaspora", "Sale of Asset", "Other"]:
        if opt.lower() in src.lower() or src.lower() in opt.lower():
            f.mark_choice(0, "Please indicate source of income", opt, dx=40)
            break

    f.text_below(0, "State Purpose of Loan", answers.get("purposeOfLoan", ""), dy=14, width_chars=60)

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
    f.text_below(0, "Physical Address", answers.get("personalDetails") or resolve_contact(answers), dy=14, occurrence=0, width_chars=60)
    f.text_right(0, "Full names", answers.get("nextOfKin", ""), dx=10)

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

    filler = CATEGORY_FILLERS.get(category_code)
    if not filler:
        print(f"Unknown category: {category_code}", file=sys.stderr)
        sys.exit(1)

    filler(payload, output_path)
    print(output_path)


if __name__ == "__main__":
    main()
