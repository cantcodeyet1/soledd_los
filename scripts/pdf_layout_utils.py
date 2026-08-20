"""
pdf_layout_utils.py — locate a label phrase on a pdfplumber page and return
its bounding box, so field values can be drawn relative to real label
positions instead of hand-transcribed coordinates.

Some of the Soledd PDF templates use a font that pdfplumber extracts with
words split into extra fragments (e.g. "Passport" -> "P" + "assport", or
"18" -> "1" + "8"). Exact token-sequence matching fails on those, so both
lookups here fall back to a fuzzy, whitespace-stripped substring match that
tolerates that kind of split.
"""

import re


def _norm(s):
    return re.sub(r"\s+", " ", s or "").strip().lower()


def _strip_punct(s):
    return s.replace("?", "").replace(",", "").replace(".", "")


def _alnum_only(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _bbox(words):
    return {
        "x0": min(w["x0"] for w in words),
        "x1": max(w["x1"] for w in words),
        "top": min(w["top"] for w in words),
        "bottom": max(w["bottom"] for w in words),
    }


def find_label_bbox(page, phrase, occurrence=0):
    """
    Find `phrase` (a short run of words) among the page's extracted words and
    return its combined bounding box: {x0, top, x1, bottom}.
    Tries an exact, punctuation-insensitive token match first; falls back to
    a fuzzy alphanumeric substring match if the font splits words oddly.
    Raises if not found either way.
    """
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    target_tokens = _strip_punct(_norm(phrase)).split()
    if not target_tokens:
        raise ValueError("empty phrase")

    clean = [_strip_punct(_norm(w["text"])) for w in words]

    matches = []
    n = len(target_tokens)
    for i in range(len(words) - n + 1):
        if clean[i:i + n] == target_tokens:
            matches.append(words[i:i + n])

    if matches:
        m = matches[occurrence] if occurrence < len(matches) else matches[-1]
        return _bbox(m)

    return _fuzzy_find(words, phrase, occurrence)


def _fuzzy_find(words, phrase, occurrence=0):
    target = _alnum_only(phrase)
    if not target:
        raise ValueError("empty phrase")

    fragments = [_alnum_only(w["text"]) for w in words]
    concat = "".join(fragments)

    starts = [m.start() for m in re.finditer(re.escape(target), concat)]
    if not starts:
        raise ValueError(f"label not found: {phrase!r}")

    idx = starts[occurrence] if occurrence < len(starts) else starts[-1]
    end = idx + len(target)

    pos = 0
    start_i = end_i = None
    for i, frag in enumerate(fragments):
        frag_start, frag_end = pos, pos + len(frag)
        if start_i is None and frag_end > idx:
            start_i = i
        if frag_start < end:
            end_i = i
        pos = frag_end
    return _bbox(words[start_i:end_i + 1])


def find_option_near(page, question_phrase, option_phrase, occurrence=0, max_dtop=22):
    """Find `option_phrase` on the same row as `question_phrase` (used for
    YES/NO and tick-box style answers)."""
    q = find_label_bbox(page, question_phrase, occurrence=occurrence)
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    target = _alnum_only(option_phrase)

    row_words = [w for w in words if abs(w["top"] - q["top"]) <= max_dtop]

    # exact single-word match first
    exact = [w for w in row_words if _alnum_only(w["text"]) == target]
    if exact:
        c = exact[0]
        return {"x0": c["x0"], "top": c["top"], "x1": c["x1"], "bottom": c["bottom"]}

    # fuzzy: concatenate the row's words and look for the option as a substring
    frags = [_alnum_only(w["text"]) for w in row_words]
    concat = "".join(frags)
    idx = concat.find(target)
    if idx != -1:
        end = idx + len(target)
        pos = 0
        start_i = end_i = None
        for i, frag in enumerate(frags):
            frag_start, frag_end = pos, pos + len(frag)
            if start_i is None and frag_end > idx:
                start_i = i
            if frag_start < end:
                end_i = i
            pos = frag_end
        return _bbox(row_words[start_i:end_i + 1])

    # last resort: plain search anywhere on the page
    return find_label_bbox(page, option_phrase)


def to_pdf_y(page_height, top_or_bottom):
    """Convert a pdfplumber top/bottom (measured from page top) to a
    reportlab y coordinate (measured from page bottom)."""
    return page_height - top_or_bottom
