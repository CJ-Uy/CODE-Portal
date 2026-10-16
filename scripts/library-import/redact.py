#!/usr/bin/env python3
"""Remove reviewer-flagged client strings from library documents, for real: the text is deleted, not covered.

    redact.py <FILES_ROOT> <REVIEWDIR> <OUTDIR>
    redact.py --selftest

REVIEWDIR/<driveId>.json: {"verdict": "clean"|"redact"|"confidential", "reason": "...",
                           "strings": [{"text": "...", "pages": [1, 3], "label": "[Client org]"}]}
Writes OUTDIR/<driveId>.pdf|.docx for each redacted document plus OUTDIR/verdicts.json:
{driveId: {"verdict": "clean"|"redacted"|"confidential", "file": "<path to upload>", "reason": "..."}}
Fails closed: no review, an invalid review, or a redaction that does not verify all end up "confidential".
Local tooling only: run it with the redact-venv python (pymupdf) and `-I`, never as an app dependency.
"""
import contextlib
import copy
import io
import json
import re
import sys
import tempfile
import traceback
import unicodedata
import zipfile
from collections import Counter
from html import unescape
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

# -I keeps the script's own directory off sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pymupdf  # noqa: E402
from extract_text import FILLER, detect_type, extract, list_entries, make_docx, make_image_pdf, make_pdf  # noqa: E402


class Failed(Exception):
    """A redaction that cannot be trusted; the document falls back to confidential."""


class Scrub:
    """Case- and whitespace-insensitive replacement of every flagged string by its label, in one pass."""

    def __init__(self, strings):
        items = sorted(strings, key=lambda s: -len(s[0]))  # longest first: "Acme Youth Council" beats "Acme"
        self.texts = [t for t, _ in items]
        self.labels = [label for _, label in items]
        ws = r"\s+"
        self.rx = re.compile("|".join(f"(?P<g{i}>{ws.join(map(re.escape, t.split()))})"
                                      for i, t in enumerate(self.texts)), re.I)

    def find(self, s):
        return self.rx.search(s) is not None

    def sub(self, s):
        return self.rx.sub(lambda m: self.labels[int(m.lastgroup[1:])], s)


def norm(s):
    """The comparison form for verification: Unicode-folded, lower case, whitespace collapsed."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s)).strip().lower()


def doc_text(path, typ):
    """Everything a reader could pull out: the extract_text text, plus bookmark titles (pdf)
    or every text part of the package with its tags stripped (docx)."""
    text = extract(path, typ)[0]
    if typ == "pdf":
        with pymupdf.open(path) as d:
            return text + "\n" + "\n".join(t for _, t, _ in d.get_toc())
    with zipfile.ZipFile(path) as z:
        parts = [z.read(n).decode("utf-8") for n in z.namelist() if TEXT_PARTS.match(n)]
    return text + "\n" + "\n".join(unescape(re.sub(r"<[^>]+>", "", p.replace("</w:p>", "\n"))) for p in parts)


def has_images(path, typ):
    if typ == "pdf":
        with pymupdf.open(path) as d:
            return any(page.get_images() for page in d)
    with zipfile.ZipFile(path) as z:
        return any(n.startswith("word/media/") for n in z.namelist())


def redact_pdf(src, dst, scrub):
    with pymupdf.open(src) as doc:
        if doc.needs_pass:
            raise Failed("encrypted pdf")
        for page in doc:
            done = []  # rects already boxed on this page, so a shorter string inside a longer one is not boxed twice
            for text, label in zip(scrub.texts, scrub.labels):
                # search_for only folds ASCII case (an upper-case n-tilde does not match a lower-case one), hence the variants
                for needle in dict.fromkeys([text, text.upper(), text.lower(), text.title()]):
                    for r in page.search_for(needle):
                        if any(d.contains(r) for d in done):
                            continue
                        done.append(r)
                        fs = min(11, r.height * 0.8)
                        fs *= min(1, r.width / pymupdf.get_text_length(label, fontname="helv", fontsize=fs))
                        # a label that would be unreadably small becomes a plain white box
                        page.add_redact_annot(r, text=label if fs >= 4 else None, fontsize=fs, fill=(1, 1, 1))
            page.apply_redactions()
        toc = doc.get_toc()
        if any(scrub.find(title) for _, title, _ in toc):
            doc.set_toc([[lvl, scrub.sub(title), pno] for lvl, title, pno in toc])
        doc.set_metadata({})
        doc.del_xml_metadata()
        doc.save(str(dst), garbage=4, deflate=True)


# Word parts that carry text, as raw-XML patterns: the XML is edited as a string, never re-serialised,
# because a parser round-trip drops unused namespace declarations that mc:Ignorable still points at.
TEXT_PARTS = re.compile(r"^(word/(document|header\d*|footer\d*|footnotes|endnotes|comments)|docProps/core)\.xml$")
RUN_TEXT = re.compile(r"(<w:(?:t|delText)(?:\s[^>]*)?>)([^<]*)(</w:(?:t|delText)>)")
PARAGRAPH = re.compile(r"<w:p(?:\s[^>]*)?(?<!/)>.*?</w:p>", re.S)  # not <w:pPr>, not a self-closing <w:p/>
TEXT_NODE = re.compile(r">([^<>]+)<")


def scrub_paragraph(p, scrub):
    runs = list(RUN_TEXT.finditer(p))
    old = [unescape(m.group(2)) for m in runs]
    new = [scrub.sub(t) for t in old]  # a string inside a single run keeps that run's formatting
    if scrub.find("".join(new)):  # a string split over runs: the first run takes the whole paragraph text
        new = [scrub.sub("".join(new))] + [""] * (len(runs) - 1)
    pairs = iter(zip(old, new))

    def put(m):
        before, after = next(pairs)
        if before == after:
            return m.group(0)
        tag = m.group(1)
        if "xml:space" not in tag:  # keep leading and trailing spaces
            tag = tag[:-1] + ' xml:space="preserve">'
        return tag + escape(after) + m.group(3)

    return RUN_TEXT.sub(put, p)


def scrub_xml(xml, scrub):
    xml = PARAGRAPH.sub(lambda m: scrub_paragraph(m.group(0), scrub), xml)

    def node(m):  # whatever text is left outside w:t (core properties, field codes), one node at a time
        before = unescape(m.group(1))
        after = scrub.sub(before)
        return m.group(0) if after == before else ">" + escape(after) + "<"

    return TEXT_NODE.sub(node, xml)


def redact_docx(src, dst, scrub):
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if TEXT_PARTS.match(item.filename):
                data = scrub_xml(data.decode("utf-8"), scrub).encode("utf-8")
            zout.writestr(copy.copy(item), data)  # a copy: writestr rewrites the ZipInfo it is given


REDACTORS = {"pdf": redact_pdf, "docx": redact_docx}
VERDICTS = ("clean", "redact", "confidential")


def redact(path, review, drive_id, outdir):
    """Redact one document and verify it. Returns the output path, or raises (and leaves no output file)."""
    typ = detect_type(path)
    if typ == "unsupported":
        raise Failed("unsupported file type")
    strings = [(" ".join(str(s["text"]).split()), s.get("label") or "[Redacted]") for s in review.get("strings", [])]
    strings = [s for s in strings if s[0]]
    if not strings:
        raise Failed("no strings listed")
    scrub = Scrub(strings)
    out = outdir / f"{drive_id}.{typ}"
    out.unlink(missing_ok=True)  # never leave a stale or half-redacted file behind
    try:
        seen = norm(doc_text(path, typ))
        missing = sum(norm(t) not in seen for t in scrub.texts)
        # a flagged string we cannot find in the text of a document with images may live in an image, where we can neither remove nor verify it
        if missing and has_images(path, typ):
            raise Failed(f"{missing} string(s) not in the text layer, and the document has images")
        REDACTORS[typ](path, out, scrub)
        left = norm(doc_text(out, typ))
        survived = sum(norm(t) in left for t in scrub.texts)
        if survived:
            raise Failed(f"{survived} string(s) survived redaction")
    except Exception:
        out.unlink(missing_ok=True)
        raise
    return out


def run(files_root, reviewdir, outdir):
    reviewdir, outdir = Path(reviewdir), Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    verdicts, failed = {}, 0
    for drive_id, path in list_entries(files_root):
        verdict, file, reason = "confidential", str(path.resolve()), "not reviewed"  # fail closed
        review_file = reviewdir / f"{drive_id}.json"
        if review_file.is_file():
            try:
                review = json.loads(review_file.read_text(encoding="utf-8"))
                kind, reason = review["verdict"], str(review.get("reason", ""))
                if kind not in VERDICTS:
                    raise ValueError("verdict")
            except Exception as e:
                kind, reason = "confidential", f"invalid review: {type(e).__name__}"
            if kind == "clean":
                verdict = "clean"
            elif kind == "redact":
                try:
                    file, verdict = str(redact(path, review, drive_id, outdir).resolve()), "redacted"
                except Exception as e:  # reasons carry counts and class names only, never document text
                    failed += 1
                    reason = "redaction failed: " + (str(e) if isinstance(e, Failed) else type(e).__name__)
        verdicts[drive_id] = {"verdict": verdict, "file": file, "reason": reason}
    (outdir / "verdicts.json").write_text(json.dumps(verdicts, indent=2), encoding="utf-8")
    n = Counter(v["verdict"] for v in verdicts.values())
    print(f"clean={n['clean']} redacted={n['redacted']} confidential={n['confidential']} failed_verification={failed}")
    return 0


# ---- selftest: synthetic documents, fictional strings only ----

def _run_quiet(*args):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = run(*args)
    return code, buf.getvalue()


def _raw(path):
    """Whole PDF with every stream decompressed, to prove text is gone from the file and not just hidden."""
    with pymupdf.open(path) as d:
        return d.tobytes(garbage=4, deflate=False, expand=255)


def selftest():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp).resolve()
        files, reviews, out = tmp / "files", tmp / "reviews", tmp / "out"
        dd = files / "Document_Data"
        reviews.mkdir()
        for name in ("pdfId", "absentId", "imgId", "cleanId", "confId", "noReviewId", "badId"):
            (dd / name).mkdir(parents=True)

        # PDF: one name per page, plus metadata and a bookmark carrying the org name
        pdf = dd / "pdfId" / "a.pdf"
        make_pdf(pdf, [FILLER + "Prepared for Juan Example today\nContact: PEÑA EXAMPLE",  # upper-case n-tilde
                       FILLER + "Client: Acme Youth Council (ACME YOUTH COUNCIL)"])
        with pymupdf.open(pdf) as d:
            d.set_metadata({"title": "Acme Youth Council notes", "author": "Juan Example"})
            d.set_toc([[1, "Acme Youth Council overview", 1], [1, "Plain heading", 2]])
            d.saveIncr()
        # DOCX: org split over three runs, an ampersand name, a member name, header, and core properties
        make_docx(dd / "docxId", [["Welcome to Acme ", "Youth", " Council today"],
                                  ["Smith & Sons Ltd paid Juan Example."],
                                  ["Plain unrelated text."]],
                  header="Acme Youth Council Header", creator="Juan Example")
        make_docx(dd / "absentId" / "b.docx", [["Nothing sensitive here."]])
        make_image_pdf(dd / "imgId" / "c.pdf", "Zed Example")  # the name exists only as pixels
        make_pdf(dd / "cleanId" / "d.pdf", [FILLER])
        make_pdf(dd / "confId" / "e.pdf", [FILLER])
        make_pdf(dd / "noReviewId" / "f.pdf", [FILLER])
        make_pdf(dd / "badId" / "g.pdf", [FILLER])

        def review(drive_id, verdict, *strings):
            body = {"verdict": verdict, "reason": "r", "strings": [
                {"text": t, "pages": [1], "label": lab} for t, lab in strings]}
            (reviews / f"{drive_id}.json").write_text(json.dumps(body), encoding="utf-8")

        org, member, amp = "[Client org]", "[Client member]", "[Org & Co]"  # a label that needs XML escaping
        review("pdfId", "redact", ("Acme Youth Council", org), ("Juan Example", member), ("Peña Example", member))
        review("docxId", "redact", ("Acme Youth Council", org), ("Smith & Sons Ltd", amp), ("Juan Example", member))
        review("absentId", "redact", ("Nobody Here", org))
        review("imgId", "redact", ("Zed Example", member))
        review("cleanId", "clean")
        review("confId", "confidential")
        (reviews / "badId.json").write_text("{not json", encoding="utf-8")
        before = {p: p.read_bytes() for p in (pdf, dd / "docxId")}

        code, stdout = _run_quiet(files, reviews, out)
        verdicts = json.loads((out / "verdicts.json").read_text(encoding="utf-8"))
        v = {k: x["verdict"] for k, x in verdicts.items()}
        assert code == 0
        assert v == {"pdfId": "redacted", "docxId": "redacted", "absentId": "redacted", "imgId": "confidential",
                     "cleanId": "clean", "confId": "confidential", "noReviewId": "confidential",
                     "badId": "confidential"}, v
        assert stdout.strip().splitlines()[-1] == "clean=1 redacted=3 confidential=4 failed_verification=1", stdout
        assert all(p.read_bytes() == b for p, b in before.items()), "originals must not be touched"

        # pdf: names gone from the text, the bookmarks, the metadata and the raw file; labels and other text stay
        red = Path(verdicts["pdfId"]["file"])
        assert red == out / "pdfId.pdf", red
        text, pages = extract(red, "pdf")
        assert pages == 2 and len(text.split("\f")) == 2
        low = norm(text)
        assert "juan example" not in low and "acme youth council" not in low and "peña" not in low, text
        assert text.count(org) == 2 and text.count(member) == 2 and "quick brown fox" in low, text  # one label per hit
        assert b"Acme" in _raw(pdf) and b"Juan" in _raw(pdf)  # control: the raw check can see the text it should miss
        raw = _raw(red)
        assert b"Acme" not in raw and b"Juan" not in raw and b"ACME" not in raw
        with pymupdf.open(red) as d:
            assert not d.metadata.get("title") and not d.metadata.get("author"), d.metadata
            assert [t for _, t, _ in d.get_toc()] == [f"{org} overview", "Plain heading"], d.get_toc()

        # docx: split runs, '&', header and core properties all handled; the package stays well-formed
        red = Path(verdicts["docxId"]["file"])
        assert extract(red, "docx")[0] == f"Welcome to {org} today\n{amp} paid {member}.\nPlain unrelated text."
        with zipfile.ZipFile(red) as z, zipfile.ZipFile(dd / "docxId") as orig:
            assert z.namelist() == orig.namelist()
            for name in z.namelist():
                low = norm(z.read(name).decode("utf-8"))
                assert "acme" not in low and "juan example" not in low and "sons" not in low, name
                ET.fromstring(z.read(name))
            assert 'mc:Ignorable="w14"' in z.read("word/document.xml").decode("utf-8")
            assert org in z.read("word/header1.xml").decode("utf-8")
            assert member in z.read("docProps/core.xml").decode("utf-8")

        assert (out / "absentId.docx").is_file()  # a string that is not in a text-only document passes trivially
        assert "not reviewed" in verdicts["noReviewId"]["reason"]
        assert verdicts["badId"]["reason"].startswith("invalid review")
        assert verdicts["imgId"]["reason"].startswith("redaction failed:") and not (out / "imgId.pdf").exists()
        assert verdicts["imgId"]["file"] == str((dd / "imgId" / "c.pdf").resolve())
        for k in ("cleanId", "confId", "noReviewId", "badId"):
            assert Path(verdicts[k]["file"]).is_file() and Path(verdicts[k]["file"]).parent.name == k

        # forced verification failure: a redactor that leaves the text in place must end up confidential, with no file left
        real = REDACTORS["docx"]
        REDACTORS["docx"] = lambda src, dst, scrub: dst.write_bytes(src.read_bytes())
        try:
            _run_quiet(files, reviews, out)
        finally:
            REDACTORS["docx"] = real
        verdicts = json.loads((out / "verdicts.json").read_text(encoding="utf-8"))
        assert verdicts["docxId"]["verdict"] == "confidential", verdicts["docxId"]
        assert verdicts["docxId"]["reason"].startswith("redaction failed:") and not (out / "docxId.docx").exists()


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
    if len(argv) != 3:
        print(__doc__)
        return 2
    return run(Path(argv[0]), Path(argv[1]), Path(argv[2]))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
