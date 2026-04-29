#!/usr/bin/env python3
"""
Extract teachers data from the school's Word doc roster.

The .docx file is a regular Word document where Table 9 contains the clean
per-row data with these 16 columns (in document order):

    [0]  العنوان            (address)
    [1]  هاتف 2             (phone 2)
    [2]  هاتف 1             (phone 1)
    [3]  الجوال             (mobile)
    [4]  الرمز البريدي       (postal code)
    [5]  صندوق البريد        (PO box)
    [6]  البريد الإلكتروني    (email)
    [7]  الأبناء > 24
    [8]  الأبناء 6-24
    [9]  الأبناء < 6
    [10] عدد الأبناء
    [11] الحالة الإجتماعية
    [12] تاريخ الولادة (Hijri)
    [13] مكان الولادة
    [14] الإسم
    [15] رقم الهوية

Output: scripts/import-data/teachers.json — fields the import-teachers script
already understands (fullName, nationalId, phone, email, notes).
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

DOCX = Path("/Users/alialhazmi/Downloads/بيانات المعلمات.docx")
OUT = Path("scripts/import-data/teachers.json")
OUT.parent.mkdir(parents=True, exist_ok=True)

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def cell_text(cell):
    return "".join(t.text or "" for t in cell.iter(f"{{{NS['w']}}}t")).strip()


def main():
    if not DOCX.exists():
        print(f"❌ Word file not found: {DOCX}", file=sys.stderr)
        sys.exit(1)

    with zipfile.ZipFile(DOCX) as z:
        with z.open("word/document.xml") as f:
            xml_data = f.read()

    root = ET.fromstring(xml_data)
    tables = list(root.iter(f"{{{NS['w']}}}tbl"))

    # Find the table whose first row matches the canonical 16-column header.
    target = None
    for t in tables:
        first_row = next(iter(t.iter(f"{{{NS['w']}}}tr")), None)
        if first_row is None:
            continue
        cells = [cell_text(c) for c in first_row.iter(f"{{{NS['w']}}}tc")]
        if (
            len(cells) == 16
            and cells[14] == "الإسم"
            and cells[15] == "رقم الهوية"
            and cells[3] == "الجوال"
        ):
            target = t
            break

    if target is None:
        print("❌ Could not locate the canonical 16-column teachers table.", file=sys.stderr)
        sys.exit(1)

    teachers = []
    rows = list(target.iter(f"{{{NS['w']}}}tr"))
    print(f"📋 Found target table with {len(rows)} rows (incl. header).")

    for row in rows[1:]:  # skip header
        cells = [cell_text(c) for c in row.iter(f"{{{NS['w']}}}tc")]
        if len(cells) < 16:
            continue
        nat_id = cells[15].strip()
        full_name = cells[14].strip()
        if not (re.fullmatch(r"\d{8,12}", nat_id) and full_name):
            continue

        address = cells[0]
        phone2 = cells[1]
        phone1 = cells[2]
        mobile = cells[3]
        email = cells[6]
        kids_total = cells[10] or "0"
        marital = cells[11]
        dob_hijri = cells[12]
        birthplace = cells[13]

        # Phone: prefer the mobile column, fall back to phone1, phone2.
        phone = mobile or phone1 or phone2 or None
        if phone:
            # Normalize Saudi numbers: convert leading "966" into "+966" or
            # "0" prefix for local mobiles, but only if the user submitted a
            # canonical 9665XXXXXXXXX pattern.
            phone = phone.strip()
            if phone.startswith("9665") and len(phone) == 12:
                phone = "0" + phone[3:]  # 9665XXXXXXXX → 05XXXXXXXX

        notes_parts = []
        if marital:
            notes_parts.append(f"الحالة الاجتماعية: {marital}")
        if dob_hijri:
            notes_parts.append(f"تاريخ الميلاد (هجري): {dob_hijri}")
        if birthplace:
            notes_parts.append(f"مكان الميلاد: {birthplace}")
        if kids_total and kids_total != "0":
            notes_parts.append(f"عدد الأبناء: {kids_total}")
        if address:
            notes_parts.append(f"العنوان: {address}")
        notes = " | ".join(notes_parts) if notes_parts else None

        teachers.append({
            "fullName": full_name,
            "nationalId": nat_id,
            "phone": phone,
            "email": email or None,
            "notes": notes,
        })

    OUT.write_text(json.dumps(teachers, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"💾 Wrote {len(teachers)} teachers → {OUT}")
    print("\nعينة (أول 3):")
    for t in teachers[:3]:
        print(f"  - {t['nationalId']} | {t['fullName']} | {t['phone']} | {t['email']}")


if __name__ == "__main__":
    main()
