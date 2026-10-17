#!/usr/bin/env python3
"""Extract plain text from the downloaded internal library documents, so reviewers can flag client data.

    extract_text.py <FILES_ROOT> <OUTDIR>
    extract_text.py --selftest

Reads FILES_ROOT/Document_Data/<driveId> (a file) or <driveId>/<name>.pdf|.docx (a directory holding one file).
Writes OUTDIR/<driveId>.txt (PDF pages joined by \\f, so page N is segment N; DOCX paragraphs by \\n, with
<w:br/> as \\n and <w:tab/> as \\t) and OUTDIR/index.tsv. Prints, one per line, what a reviewer cannot rely on:
NO_TEXT <id> (under 200 non-space characters: a scan), PARTIAL_SCAN <id> (enough text overall, but some PDF page has
under 20 non-space characters: that page is probably a scan), UNSUPPORTED <id> (not a readable pdf or docx).
Local tooling only: run it with the redact-venv python (pymupdf) as `python -B -I`, never as an app dependency.
"""
import contextlib
import io
import sys
import tempfile
import traceback
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

import pymupdf

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MIN_CHARS = 200  # fewer non-whitespace characters than this in total = probably a scan


def list_entries(files_root):
    """[(driveId, path)] for every Document_Data entry. A directory resolves to its single file."""
    entries = []
    for entry in sorted((Path(files_root) / "Document_Data").iterdir()):
        path = entry
        if entry.is_dir():
            files = [f for f in entry.rglob("*") if f.is_file()]
            if len(files) == 1:  # any other count stays the directory itself, which detect_type() calls unsupported
                path = files[0]
        entries.append((entry.name, path))
    return entries


def detect_type(path):
    """'pdf' | 'docx' | 'unsupported', by magic bytes."""
    if not path.is_file():
        return "unsupported"
    with open(path, "rb") as f:
        head = f.read(5)
    if head == b"%PDF-":
        return "pdf"
    if head[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(path) as z:
                return "docx" if "word/document.xml" in z.namelist() else "unsupported"
        except zipfile.BadZipFile:
            pass
    return "unsupported"


def extract(path, typ):
    """(text, pages). PDF pages are joined by \\f; a docx is one page, paragraphs joined by \\n."""
    if typ == "pdf":
        with pymupdf.open(path) as doc:
            if doc.needs_pass:
                raise ValueError("encrypted pdf")
            return "\f".join(page.get_text() for page in doc), len(doc)
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    return "\n".join(paragraph_text(p) for p in root.iter(W + "p")), 1


def paragraph_text(p):
    """w:t text, with a line break or tab inside a run kept as "\\n" / "\\t" so words never fuse."""
    out = []
    for r in p.iter(W + "r"):
        for el in r:  # direct children only: a <w:tab> in <w:pPr> is a tab stop, not a character
            if el.tag == W + "t":
                out.append(el.text or "")
            elif el.tag in (W + "br", W + "cr"):
                out.append("\n")
            elif el.tag == W + "tab":
                out.append("\t")
    return "".join(out)


def nonspace(s):
    return sum(not c.isspace() for c in s)


def run(files_root, outdir):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    rows = [("driveId", "path", "type", "pages", "chars")]
    counts = {"pdf": 0, "docx": 0, "unsupported": 0}
    no_text = partial = total = 0
    entries = list_entries(files_root)
    for drive_id, path in entries:
        pages = chars = 0
        try:  # inside the try: a locked or vanished file must not stop the batch
            typ = detect_type(path)
            if typ != "unsupported":
                text, pages = extract(path, typ)
        except Exception as e:  # corrupt, encrypted or locked: unsupported (class name only, never document content)
            print(f"ERROR {drive_id} {type(e).__name__}", file=sys.stderr)
            typ = "unsupported"
        if typ == "unsupported":
            pages = 0
            print(f"UNSUPPORTED {drive_id}")
        else:
            (outdir / f"{drive_id}.txt").write_bytes(text.encode("utf-8", "replace"))  # bytes: no \n -> \r\n on Windows
            chars = len(text)
            total += chars
            if nonspace(text) < MIN_CHARS:
                no_text += 1
                print(f"NO_TEXT {drive_id}")
            elif typ == "pdf" and any(nonspace(page) < 20 for page in text.split("\f")):
                partial += 1  # enough text overall, but a near-empty page is probably a scan the review will not see
                print(f"PARTIAL_SCAN {drive_id}")
        counts[typ] += 1
        rows.append((drive_id, str(path.resolve()), typ, str(pages), str(chars)))
    (outdir / "index.tsv").write_bytes("".join("\t".join(r) + "\n" for r in rows).encode("utf-8"))
    print(f"SUMMARY documents={len(entries)} pdf={counts['pdf']} docx={counts['docx']} "
          f"unsupported={counts['unsupported']} no_text={no_text} partial_scan={partial} chars={total}")
    return 0


# ---- synthetic fixtures, shared with redact.py's selftest (fictional strings only) ----

FILLER = "The quick brown fox plans a youth leadership workshop.\n" * 4


def make_pdf(path, pages):
    """Text PDF, one page per string."""
    doc = pymupdf.open()
    for text in pages:
        doc.new_page().insert_text((72, 72), text, fontsize=11)
    doc.save(path)


def make_image_pdf(path, text=""):
    """Image-only PDF (a scan): `text` is baked into the pixels, so there is no text layer."""
    src = pymupdf.open()
    page = src.new_page()
    page.insert_text((72, 100), text or " ", fontsize=14)
    doc = pymupdf.open()
    out = doc.new_page()
    out.insert_image(out.rect, pixmap=page.get_pixmap(dpi=100))
    doc.save(path)


def make_encrypted_pdf(path):
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), FILLER, fontsize=11)
    doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner-pw", user_pw="user-pw")


NS_DECL = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
           'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
           'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
           'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"')


def make_docx(path, paragraphs, header=None, creator=None, raw_body="", extra=None):
    """Minimal .docx. paragraphs = [[run, ...], ...]. A run is text (its own <w:r><w:t>) or one of the
    literals "<w:br/>", "<w:tab/>" (a run holding just that). raw_body is appended to the body as XML;
    extra = {member name: str or bytes} adds more package members."""
    def para(runs):
        body = "".join(f"<w:r>{r}</w:r>" if r in ("<w:br/>", "<w:tab/>")
                       else f'<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{escape(r)}</w:t></w:r>' for r in runs)
        # the tab stop in pPr is not a tab character and must not show up in the text
        return f'<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>{body}</w:p>'

    parts = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        "word/document.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {NS_DECL}><w:body>'
                             + "".join(para(p) for p in paragraphs) + raw_body + "</w:body></w:document>",
    }
    if header:
        parts["word/header1.xml"] = f'<?xml version="1.0" encoding="UTF-8"?><w:hdr {NS_DECL}>{para([header])}</w:hdr>'
    if creator:
        parts["docProps/core.xml"] = ('<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties '
                                      'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
                                      f'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>{escape(creator)}</dc:creator></cp:coreProperties>')
    parts.update(extra or {})
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)


def selftest():
    global detect_type
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        docs = tmp / "files" / "Document_Data"
        (docs / "pdfId").mkdir(parents=True)
        make_pdf(docs / "pdfId" / "two pages.pdf", [FILLER + "Alpha page marker", FILLER + "Beta page marker"])
        make_docx(docs / "docxId", [["Hello ", "wor", "ld"], ["Second paragraph"]])  # bare file, no extension
        make_docx(docs / "brId", [["A", "<w:br/>", "B", "<w:tab/>", "C"], ["D"]])
        (docs / "scanId").mkdir()
        make_image_pdf(docs / "scanId" / "scan.pdf", "Scanned words")
        (docs / "partialId").mkdir()  # enough text overall, but page 2 is nearly empty: probably a scanned page
        make_pdf(docs / "partialId" / "p.pdf", [FILLER + FILLER, "x"])
        (docs / "junkId").write_bytes(b"not a document")
        (docs / "encId").mkdir()
        make_encrypted_pdf(docs / "encId" / "e.pdf")
        (docs / "corruptId").mkdir()
        (docs / "corruptId" / "c.pdf").write_bytes(b"%PDF-1.4\nthis is not a pdf")
        (docs / "nodocId").mkdir()
        with zipfile.ZipFile(docs / "nodocId" / "n.docx", "w") as z:
            z.writestr("readme.txt", "a zip with no word/document.xml")
        (docs / "lockedId").write_bytes(b"%PDF-1.4 stand-in for a file another program has open")

        real_detect = detect_type

        def detect_or_lock(p):
            if p.name == "lockedId":
                raise PermissionError("locked")
            return real_detect(p)

        out = tmp / "text"
        buf, err = io.StringIO(), io.StringIO()
        detect_type = detect_or_lock
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
                code = run(tmp / "files", out)
        finally:
            detect_type = real_detect
        lines = buf.getvalue().splitlines()

        assert code == 0
        pages = (out / "pdfId.txt").read_text(encoding="utf-8").split("\f")
        assert len(pages) == 2 and "Alpha page marker" in pages[0] and "Beta page marker" in pages[1], pages
        assert "Beta" not in pages[0] and "Alpha" not in pages[1]
        assert (out / "docxId.txt").read_text(encoding="utf-8") == "Hello world\nSecond paragraph"
        assert (out / "brId.txt").read_bytes() == b"A\nB\tC\nD"  # br and tab become whitespace; a tab stop does not
        assert "NO_TEXT scanId" in lines and "NO_TEXT pdfId" not in lines
        assert "PARTIAL_SCAN partialId" in lines and not [l for l in lines if l.startswith("PARTIAL_SCAN") and "partialId" not in l]
        assert "NO_TEXT partialId" not in lines
        for bad in ("junkId", "encId", "corruptId", "nodocId", "lockedId"):
            assert f"UNSUPPORTED {bad}" in lines and not (out / f"{bad}.txt").exists(), bad
        assert "ERROR encId ValueError" in err.getvalue() and "ERROR lockedId PermissionError" in err.getvalue()
        # no_text=3: the scan and the two tiny docx fixtures
        assert lines[-1].startswith("SUMMARY documents=10 pdf=3 docx=2 unsupported=5 no_text=3 partial_scan=1 chars="), lines[-1]

        rows = [r.split("\t") for r in (out / "index.tsv").read_text(encoding="utf-8").splitlines()]
        assert rows[0] == ["driveId", "path", "type", "pages", "chars"], rows[0]
        by_id = {r[0]: r for r in rows[1:]}
        assert [by_id[i][2] for i in ("pdfId", "docxId", "scanId", "junkId", "encId")] == ["pdf", "docx", "pdf", "unsupported", "unsupported"]
        assert by_id["pdfId"][3] == "2" and by_id["docxId"][3] == "1" and by_id["junkId"][3] == "0"
        assert by_id["docxId"][4] == str(len("Hello world\nSecond paragraph"))
        assert Path(by_id["pdfId"][1]).is_file() and Path(by_id["docxId"][1]).is_file()


def main(argv):
    if argv == ["--selftest"]:
        try:
            selftest()
        except Exception:  # any failure is a failed selftest
            traceback.print_exc()
            print("SELFTEST FAIL")
            return 1
        print("SELFTEST OK")
        return 0
    if len(argv) != 2:
        print(__doc__)
        return 2
    return run(Path(argv[0]), Path(argv[1]))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
