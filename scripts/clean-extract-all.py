#!/usr/bin/env python3
"""
Cell-precise, row-pair-aware extraction of all student data from the PDF.

Each student occupies TWO consecutive rows in the source table:
    main row  : Hijri DOB | national id | Arabic nationality | Arabic name | seq
    aux  row  : Gregorian DOB | English nationality | Latin name (no ID)

The previous extractor used raw page text and accidentally bled words from
the aux row of student N into the main row of student N-1. We now rebuild
each student strictly from its own pair of cells.

Output: scripts/import-data/clean-students.json
"""

from __future__ import annotations
import fitz
import json
import re
import unicodedata
from pathlib import Path

PDF = Path("/Users/alialhazmi/Downloads/بيانات 1.pdf")
OUT = Path(__file__).parent / "import-data" / "clean-students.json"

ID_RE = re.compile(r"^\d{8,15}$")
DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
SEQ_RE = re.compile(r"^\d{1,4}$")

# ---------- text decoding ----------

def is_arabic_cp(cp: int) -> bool:
    return (
        0x0600 <= cp <= 0x06FF
        or 0x0750 <= cp <= 0x077F
        or 0xFB50 <= cp <= 0xFDFF
        or 0xFE70 <= cp <= 0xFEFF
        or cp == 0x0BCC
    )


def decode_shifted(s: str) -> str:
    out = []
    for ch in s:
        cp = ord(ch)
        if 0x0200 <= cp <= 0x03FF:
            out.append(chr(cp + 0xFB00))
        else:
            out.append(ch)
    return unicodedata.normalize("NFKC", "".join(out))


def reverse_arabic_runs(s: str) -> str:
    res, buf = [], []
    for ch in s:
        if is_arabic_cp(ord(ch)):
            buf.append(ch)
        else:
            if buf:
                res.append("".join(reversed(buf)))
                buf = []
            res.append(ch)
    if buf:
        res.append("".join(reversed(buf)))
    return "".join(res)


LIGATURES = {"ௌ": "الله", "﷯": "ء"}


def fix_text(raw: str) -> str:
    if not raw:
        return ""
    s = decode_shifted(raw)
    s = reverse_arabic_runs(s)
    for k, v in LIGATURES.items():
        s = s.replace(k, v)
    s = re.sub(r"[\x00-\x1F\u00A0]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def fix_name(raw: str) -> str:
    s = fix_text(raw)
    if not s:
        return ""
    words = s.split(" ")
    if len(words) > 1:
        words = list(reversed(words))
    return " ".join(words)


# ---------- page metadata ----------

GRADE_LABELS = {
    "الأول": "الأول ابتدائي",
    "الاول": "الأول ابتدائي",
    "األول": "الأول ابتدائي",
    "الثاني": "الثاني ابتدائي",
    "الثالث": "الثالث ابتدائي",
    "الرابع": "الرابع ابتدائي",
    "الخامس": "الخامس ابتدائي",
    "السادس": "السادس ابتدائي",
}

GRADE_NUM = {
    "الأول ابتدائي": "1",
    "الثاني ابتدائي": "2",
    "الثالث ابتدائي": "3",
    "الرابع ابتدائي": "4",
    "الخامس ابتدائي": "5",
    "السادس ابتدائي": "6",
}


def normalize_arabic(s: str) -> str:
    """Strip lam-alef and other ligatures so we can do reliable string matching."""
    table = {
        "ﻷ": "لا", "ﻸ": "لا", "ﻹ": "لا", "ﻺ": "لا", "ﻻ": "لا", "ﻼ": "لا",
        "ﻵ": "لا", "ﻶ": "لا",
        "أ": "ا", "إ": "ا", "آ": "ا",
        "ة": "ه", "ى": "ي", "ؤ": "و", "ئ": "ي",
    }
    out = []
    for ch in s:
        out.append(table.get(ch, ch))
    return "".join(out)


def detect_page_meta(page) -> tuple[str | None, str | None, str]:
    """Return (grade, section_number, gender) inferred from page header."""
    raw = page.get_text("text")
    fixed = fix_text(raw.replace("\n", " "))
    norm = normalize_arabic(fixed)

    # tokens that may appear (with extra alif from ligature normalization)
    grade_tokens = [
        ("الاول", "الأول ابتدائي"),
        ("الول",  "الأول ابتدائي"),     # fallback shape from ligature
        ("االول", "الأول ابتدائي"),
        ("الثاني", "الثاني ابتدائي"),
        ("الثالث", "الثالث ابتدائي"),
        ("الرابع", "الرابع ابتدائي"),
        ("الخامس", "الخامس ابتدائي"),
        ("السادس", "السادس ابتدائي"),
    ]
    grade = None
    # restrict the search to the page header area: between "الصف" and "القسم"
    header_seg = norm
    m = re.search(r"الصف(.{0,80})القسم", norm)
    if m:
        header_seg = m.group(1)
    for token, full in grade_tokens:
        if token in header_seg:
            grade = full
            break

    m = re.search(r"الفصل\s+(\d+)", norm)
    section_num = m.group(1) if m else None

    if "بنين" in norm:
        gender = "بنين"
    else:
        gender = "بنات"
    return grade, section_num, gender


# ---------- row pairing ----------

NATIONALITY_AR = {
    "السعودية", "اليمنية", "السورية", "الفلسطينية", "المصرية",
    "الأردنية", "الباكستانية", "الإيرانية", "الجزائرية", "السودانية",
    "العراقية", "التركية", "الإماراتية", "اللبنانية", "التونسية",
}


def parse_main_row(row: list[str | None]) -> dict | None:
    """A main row has the national-id; extract its fields."""
    out: dict = {"_columns": {}}
    id_val = None
    hijri = None
    nationality = None
    for ci, cell in enumerate(row or []):
        if not cell:
            continue
        text = cell.strip()
        if ID_RE.match(text) and id_val is None:
            id_val = text
            out["_columns"]["id"] = ci
            continue
        if DATE_RE.match(text):
            year = int(text.split("/")[-1])
            if year < 1900 and hijri is None:
                hijri = text
                out["_columns"]["dob_hijri"] = ci
            continue
        fx = fix_text(cell)
        if fx in NATIONALITY_AR and nationality is None:
            nationality = fx
            out["_columns"]["nationality_ar"] = ci
    if not id_val:
        return None
    out["nationalId"] = id_val
    out["dobHijri"] = hijri
    out["nationalityAr"] = nationality
    return out


def parse_aux_row(row: list[str | None]) -> dict:
    """An aux row has the Gregorian DOB and Latin name."""
    out: dict = {"dobGreg": None, "nationalityEn": None, "latinName": None}
    if not row:
        return out
    has_id = any(c and ID_RE.match(c.strip()) for c in row if c)
    if has_id:  # actually a main row; not aux
        return out
    for ci, cell in enumerate(row):
        if not cell:
            continue
        text = cell.strip()
        if DATE_RE.match(text):
            year = int(text.split("/")[-1])
            if year >= 1900 and out["dobGreg"] is None:
                out["dobGreg"] = text
            continue
    return out


def to_iso(dob_greg: str | None) -> str | None:
    if not dob_greg:
        return None
    dd, mm, yyyy = dob_greg.split("/")
    return f"{yyyy}-{mm}-{dd}"


# ---------- main ----------

def extract():
    doc = fitz.open(PDF)
    rows: list[dict] = []
    seen: set[str] = set()
    pages_used = 0
    for pi in range(doc.page_count):
        page = doc[pi]
        grade, section_num, gender = detect_page_meta(page)
        try:
            tabs = page.find_tables()
        except Exception:
            continue
        if not tabs.tables:
            continue
        pages_used += 1

        for t in tabs.tables:
            ext = t.extract()
            if not ext:
                continue
            # find name column from header
            name_col = None
            for hr in ext[:3]:
                for ci, cell in enumerate(hr or []):
                    if not cell:
                        continue
                    fx = fix_text(cell)
                    if "اسم" in fx and "الطالب" in fx:
                        name_col = ci
                        break
                    if "Student" in cell and "Name" in cell:
                        name_col = ci
                        break
                if name_col is not None:
                    break
            if name_col is None:
                name_col = 11

            i = 0
            while i < len(ext):
                main = parse_main_row(ext[i])
                if not main:
                    i += 1
                    continue
                row_main = ext[i]
                aux = parse_aux_row(ext[i + 1]) if i + 1 < len(ext) else parse_aux_row(None)
                # extract name from name_col on the main row
                name = ""
                if name_col < len(row_main):
                    name = fix_name(row_main[name_col] or "")
                if not name:
                    i += 1
                    continue
                if main["nationalId"] in seen:
                    i += 2 if aux.get("dobGreg") else 1
                    continue
                seen.add(main["nationalId"])

                section_class = section_num
                if section_num and gender == "بنين":
                    section_class = f"{section_num}-ب"

                rows.append({
                    "nationalId": main["nationalId"],
                    "fullName": name,
                    "grade": grade,
                    "section": f"{GRADE_NUM[grade]}/{section_class}" if grade and section_class else None,
                    "gender": gender,
                    "dateOfBirth": to_iso(aux.get("dobGreg")),
                    "dobHijri": main.get("dobHijri"),
                    "nationality": main.get("nationalityAr"),
                })
                i += 2 if aux.get("dobGreg") else 1

    print(f"Pages with table: {pages_used}")
    return rows


def main():
    rows = extract()
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✓ Extracted {len(rows)} clean students → {OUT}")
    print("\nSample (first 8):")
    for r in rows[:8]:
        print(f"  {r['nationalId']} | {r['grade']} {r['section']} | {r['gender']} | DOB={r['dateOfBirth']} | {r['fullName']}")
    # quick stats
    by_grade: dict = {}
    for r in rows:
        g = r["grade"] or "غير معروف"
        by_grade[g] = by_grade.get(g, 0) + 1
    print("\nBy grade:")
    for g, c in sorted(by_grade.items()):
        print(f"  {g}: {c}")
    no_dob = sum(1 for r in rows if not r["dateOfBirth"])
    no_grade = sum(1 for r in rows if not r["grade"])
    no_section = sum(1 for r in rows if not r["section"])
    print(f"\nIncomplete rows: no DOB={no_dob}, no grade={no_grade}, no section={no_section}")


if __name__ == "__main__":
    main()
