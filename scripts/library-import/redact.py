#!/usr/bin/env python3
"""Remove reviewer-flagged client strings from library documents, for real: the text is deleted, not covered.

    redact.py <FILES_ROOT> <REVIEWDIR> <OUTDIR>
    redact.py --selftest

REVIEWDIR/<driveId>.json: {"verdict": "clean"|"redact"|"confidential", "reason": "...",
                           "strings": [{"text": "...", "pages": [1, 3], "label": "[Client org]"}]}
Writes OUTDIR/<driveId>.pdf|.docx for each redacted document plus OUTDIR/verdicts.json:
{driveId: {"verdict": "clean"|"redacted"|"confidential", "file": "<path to upload>", "reason": "...", "has_images": bool}}
Fails closed. A document is only "clean" or "redacted" when it is readable, was reviewed, and no flagged string can
still be found in it: not in its text, not when a hyphen, line break or tab splits the name, and not in the
containers a reader never sees (comments, attributes, annotations, links, attachments, metadata). Everything else,
including a review that cannot be trusted, ends up "confidential". "has_images" marks documents whose pictures
nobody has checked.
Local tooling only: run it with the redact-venv python (pymupdf) as `python -B -I`, never as an app dependency.
"""
import contextlib
import copy
import importlib.util
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

import pymupdf

sys.dont_write_bytecode = True  # no __pycache__ in the repo
# Load the sibling by file path: `python -I` keeps the script directory off sys.path on purpose.
_spec = importlib.util.spec_from_file_location("extract_text", Path(__file__).with_name("extract_text.py"))
et = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(et)
detect_type, extract, list_entries, nonspace, MIN_CHARS = et.detect_type, et.extract, et.list_entries, et.nonspace, et.MIN_CHARS


class Failed(Exception):
    """A redaction that cannot be trusted; the document falls back to confidential.
    cause: "verification" (a flagged string is still there), "unverifiable" (it may sit in an image), "error"."""

    def __init__(self, message, cause="error"):
        super().__init__(message)
        self.cause = cause


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


def variants(text):
    return list(dict.fromkeys([text, text.upper(), text.lower(), text.title()]))


def norm(s):
    """Comparison form: Unicode-folded, lower case, whitespace collapsed."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s)).strip().lower()


def squash(s):
    """Letters and digits only, lower case: finds a name that a hyphen, line break or tab has split."""
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", s)).lower()


class Haystack:
    """Everything that can be read out of a document. `texts` are matched as written and squashed; `blobs`
    (binary containers) as written only, because squashing random bytes would invent matches."""

    def __init__(self, texts, blobs, labels=()):
        texts, blobs = "\n".join(texts), "\n".join(blobs)
        for label in labels:  # our own labels are not leaks, even if a flagged string happens to sit inside one
            texts, blobs = texts.replace(label, " "), blobs.replace(label, " ")
        self.n, self.b, self.q = norm(texts), norm(blobs), squash(texts)

    def has(self, s):
        q = squash(s)
        return norm(s) in self.n or norm(s) in self.b or (q != "" and q in self.q)


TEXT_PARTS = re.compile(r"^(word/(document|header\d*|footer\d*|footnotes|endnotes|comments)|docProps/core)\.xml$")
THUMBNAIL = re.compile(r"^docProps/thumbnail\.\w+$", re.I)
XMLISH = re.compile(r"\.(xml|rels|vml|txt|json|html?)$", re.I)
IMAGE_MEMBER = re.compile(r"\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|webp)$|^word/embeddings/", re.I)
IMAGE_OBJECT = re.compile(r"/Subtype\s*/Image")
UTF16_HEX = re.compile(r"<(FEFF[0-9A-Fa-f\s]*)>")  # how PDFs often store titles and annotation text


def pdf_haystack(path):
    texts, blobs = [extract(path, "pdf")[0]], []  # raises for an encrypted pdf
    with pymupdf.open(path) as d:
        texts += [title for _, title, _ in d.get_toc()]
        for page in d:
            for annot in page.annots() or []:
                texts += map(str, annot.info.values())
            for widget in page.widgets() or []:
                texts += [str(widget.field_name), str(widget.field_value), str(widget.field_label)]
            for link in page.get_links():
                texts += [str(link.get("uri", "")), str(link.get("file", ""))]
        # every object's dictionary and every stream but the images (a scan's pages are huge and hold no strings);
        # that includes embedded files, XMP and content streams
        for xref in range(1, d.xref_length()):
            obj = d.xref_object(xref, compressed=False)
            blobs.append(obj)
            for h in UTF16_HEX.findall(obj):
                h = re.sub(r"\s", "", h)
                texts.append(bytes.fromhex(h[: len(h) // 2 * 2]).decode("utf-16-be", "ignore"))
            if d.xref_is_stream(xref) and not IMAGE_OBJECT.search(obj):
                blobs.append(d.xref_stream(xref).decode("latin-1"))
    return texts, blobs


def docx_haystack(path):
    texts, blobs = [extract(path, "docx")[0]], []
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            texts.append(name)
            data = z.read(name)
            if XMLISH.search(name):
                xml = data.decode("utf-8", "ignore")
                text = re.sub(r"</w:p>|<w:(?:br|cr|tab)\b[^>]*>", "\n", xml)  # breaks and tabs separate words
                texts += [unescape(xml), unescape(re.sub(r"<[^>]+>", "", text))]  # raw (attributes) and tags stripped (split runs)
            else:
                blobs.append(data.decode("latin-1"))
    return texts, blobs


def haystack(path, typ):
    return pdf_haystack(path) if typ == "pdf" else docx_haystack(path)


def has_images(path, typ):
    """True when the document holds pictures, where text can hide (a logo, a screenshot)."""
    if typ == "pdf":
        with pymupdf.open(path) as d:
            return any(page.get_images() for page in d)
    with zipfile.ZipFile(path) as z:
        return any(IMAGE_MEMBER.search(n) and not THUMBNAIL.match(n) for n in z.namelist())


def images_flag(path):
    """has_images for the verdict file; True also when the file cannot be read to tell (fail closed)."""
    try:
        typ = detect_type(path)
        return typ == "unsupported" or has_images(path, typ)
    except Exception:
        return True


def redact_pdf(src, dst, scrub):
    with pymupdf.open(src) as doc:
        if doc.needs_pass:
            raise Failed("encrypted pdf")
        for page in doc:
            done = []  # rects already boxed on this page, so a shorter string inside a longer one is not boxed twice
            for text, label in zip(scrub.texts, scrub.labels):
                # search_for only folds ASCII case (an upper-case n-tilde does not match a lower-case one), hence the variants
                for needle in variants(text):
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
RUN_TEXT = re.compile(r"(<w:t(?:\s[^>]*)?>)([^<]*)(</w:t>)")  # tracked-deleted <w:delText> is left to the node pass
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
            if THUMBNAIL.match(item.filename):
                continue  # a rendered picture of page 1, and its relationship below
            data = zin.read(item.filename)
            if item.filename == "_rels/.rels":
                data = re.sub(rb"<Relationship\b[^>]*thumbnail[^>]*/>", b"", data)
            elif TEXT_PARTS.match(item.filename):
                data = scrub_xml(data.decode("utf-8"), scrub).encode("utf-8")
            zout.writestr(copy.copy(item), data)  # a copy: writestr rewrites the ZipInfo it is given


REDACTORS = {"pdf": redact_pdf, "docx": redact_docx}
VERDICTS = ("clean", "redact", "confidential")


def survivors(out, typ, scrub):
    """How many flagged strings can still be found in the redacted file."""
    after = Haystack(*haystack(out, typ), labels=scrub.labels)
    return sum(after.has(t) for t in scrub.texts)


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
        before = Haystack(*haystack(path, typ))
        missing = sum(not before.has(t) for t in scrub.texts)
        # a flagged string we cannot find in a document with images may live in an image, where we can neither remove nor verify it
        if missing and has_images(path, typ):
            raise Failed(f"{missing} string(s) not found in the text of a document with images", "unverifiable")
        REDACTORS[typ](path, out, scrub)
        left = survivors(out, typ, scrub)
        if left:
            raise Failed(f"{left} string(s) survived redaction", "verification")
    except Exception:
        out.unlink(missing_ok=True)
        raise
    return out


def clean_problem(path):
    """Why a "clean" review cannot be trusted for this file, or None."""
    try:
        typ = detect_type(path)
        if typ == "unsupported":
            return "unsupported file type"
        if nonspace(extract(path, typ)[0]) < MIN_CHARS:
            return "no text layer, so there was nothing to review"
    except Exception as e:
        return f"unreadable ({type(e).__name__})"
    return None


def run(files_root, reviewdir, outdir):
    reviewdir, outdir = Path(reviewdir), Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    verdicts, causes = {}, Counter()
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
            # a reviewer's free text can carry client names, so it is kept only on documents that stay local
            if kind == "clean":
                problem = clean_problem(path)
                if problem:
                    causes["clean_demoted"] += 1
                    reason = f"clean demoted: {problem}"
                else:
                    verdict, reason = "clean", "reviewed"
            elif kind == "redact":
                try:
                    file, verdict, reason = str(redact(path, review, drive_id, outdir).resolve()), "redacted", "reviewed"
                except Exception as e:  # reasons carry counts and class names only, never document text
                    causes[e.cause if isinstance(e, Failed) else "error"] += 1
                    reason = "redaction failed: " + (str(e) if isinstance(e, Failed) else type(e).__name__)
        verdicts[drive_id] = {"verdict": verdict, "file": file, "reason": reason, "has_images": images_flag(path)}
    (outdir / "verdicts.json").write_text(json.dumps(verdicts, indent=2), encoding="utf-8")
    n = Counter(v["verdict"] for v in verdicts.values())
    print(f"clean={n['clean']} redacted={n['redacted']} confidential={n['confidential']} "
          f"failed_verification={causes['verification']} failed_unverifiable={causes['unverifiable']} "
          f"failed_error={causes['error']} clean_demoted={causes['clean_demoted']}")
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


XMP = ('<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
       'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">'
       '<dc:creator><rdf:Seq><rdf:li>Juan Example</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF>'
       '</x:xmpmeta><?xpacket end="w"?>')
RELS = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/>'
        '</Relationships>')


def selftest():
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp).resolve()
        files, reviews, out = tmp / "files", tmp / "reviews", tmp / "out"
        dd = files / "Document_Data"
        dd.mkdir(parents=True)
        reviews.mkdir()
        org, member, amp = "[Client org]", "[Client member]", "[Org & Co]"  # amp: a label that needs XML escaping
        ACME, JUAN = ("Acme Youth Council", org), ("Juan Example", member)

        def doc(drive_id, name):  # a directory entry holding one file, like most of Document_Data
            (dd / drive_id).mkdir()
            return dd / drive_id / name

        def review(drive_id, verdict, *strings):
            body = {"verdict": verdict, "reason": "r", "strings": [{"text": t, "pages": [1], "label": lab} for t, lab in strings]}
            (reviews / f"{drive_id}.json").write_text(json.dumps(body), encoding="utf-8")

        def edit_pdf(path, fn):
            with pymupdf.open(path) as d:
                fn(d)
                d.saveIncr()

        # --- PDFs that must come out redacted: one name per page, plus metadata, XMP and a bookmark
        pdf = doc("pdfId", "a.pdf")
        make_pdf = et.make_pdf
        make_pdf(pdf, [et.FILLER + "Prepared for Juan Example today\nContact: PEÑA EXAMPLE",  # upper-case n-tilde
                       et.FILLER + "Client: Acme Youth Council (ACME YOUTH COUNCIL)"])
        edit_pdf(pdf, lambda d: (d.set_metadata({"title": "Acme Youth Council notes", "author": "Juan Example"}),
                                 d.set_toc([[1, "Acme Youth Council overview", 1], [1, "Plain heading", 2]]),
                                 d.set_xml_metadata(XMP)))
        make_pdf(doc("wrapId", "w.pdf"), [et.FILLER + "Client is Acme Youth\nCouncil of the region"])  # a name wrapped over two lines
        review("pdfId", "redact", ACME, JUAN, ("Peña Example", member))
        review("wrapId", "redact", ACME)
        make_pdf(doc("labelId", "q.pdf"), [et.FILLER + "The Client signed here"])  # the flagged word is inside its own label
        review("labelId", "redact", ("Client", org))

        # --- PDFs that must end up confidential: the name survives somewhere the redaction cannot reach
        make_pdf(doc("hyphId", "h.pdf"), [et.FILLER + "Client is Acme Youth Coun-\ncil of the region"])  # hyphenated wrap
        make_pdf(doc("annotId", "n.pdf"), [et.FILLER])
        edit_pdf(dd / "annotId" / "n.pdf", lambda d: d[0].add_text_annot((100, 100), "Note: Juan Example said hi").set_info(title="Juan Example"))
        make_pdf(doc("annot2Id", "n2.pdf"), [et.FILLER])  # accented text is stored as UTF-16 in a hex string
        edit_pdf(dd / "annot2Id" / "n2.pdf", lambda d: d[0].add_text_annot((100, 100), "Note: Peña Example said hi"))
        make_pdf(doc("annot3Id", "n3.pdf"), [et.FILLER])  # ... or in a literal with octal escapes, which only the annotation API decodes

        def utf16_literal(d):
            a = d[0].add_text_annot((100, 100), "x")
            d.xref_set_key(a.xref, "Contents", r"(\376\377" + "".join(r"\000" + c for c in "Juan Example") + ")")

        edit_pdf(dd / "annot3Id" / "n3.pdf", utf16_literal)
        make_pdf(doc("linkId", "l.pdf"), [et.FILLER])
        edit_pdf(dd / "linkId" / "l.pdf", lambda d: d[0].insert_link(
            {"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(72, 50, 200, 70), "uri": "https://example.test/Juan-Example"}))
        make_pdf(doc("widgetId", "wd.pdf"), [et.FILLER])  # a filled-in form field

        def add_field(d):
            w = pymupdf.Widget()
            w.field_type, w.field_name, w.field_value = pymupdf.PDF_WIDGET_TYPE_TEXT, "who", "Juan Example"
            w.rect = pymupdf.Rect(72, 100, 250, 120)
            d[0].add_widget(w)

        edit_pdf(dd / "widgetId" / "wd.pdf", add_field)
        make_pdf(doc("embId", "m.pdf"), [et.FILLER])
        edit_pdf(dd / "embId" / "m.pdf", lambda d: d.embfile_add("n.txt", b"Juan Example was here"))
        make_pdf(doc("offId", "o.pdf"), [et.FILLER])  # a literal string drawn off the page: never extracted, still in the file

        def draw_off_page(d):
            xref = d[0].get_contents()[0]
            d.update_stream(xref, d.xref_stream(xref) + b"\nBT /helv 11 Tf 3000 100 Td (Juan Example) Tj ET\n")

        edit_pdf(dd / "offId" / "o.pdf", draw_off_page)
        make_pdf(doc("catalogId", "k2.pdf"), [et.FILLER])  # a string in a PDF object no reader shows
        edit_pdf(dd / "catalogId" / "k2.pdf", lambda d: d.xref_set_key(d.pdf_catalog(), "CustomNote", "(Juan Example)"))
        et.make_image_pdf(doc("imgId", "c.pdf"), "Zed Example")  # the name exists only as pixels
        et.make_encrypted_pdf(doc("encId", "e.pdf"))
        doc("corruptId", "k.pdf").write_bytes(b"%PDF-1.4\nthis is not a pdf")
        with zipfile.ZipFile(doc("nodocId", "z.docx"), "w") as z:
            z.writestr("readme.txt", "a zip with no word/document.xml")
        review("hyphId", "redact", ACME)
        review("annotId", "redact", JUAN)
        review("annot2Id", "redact", ("Peña Example", member))
        review("annot3Id", "redact", JUAN)
        review("linkId", "redact", JUAN)
        review("widgetId", "redact", JUAN)
        review("embId", "redact", JUAN)
        review("offId", "redact", JUAN)
        review("catalogId", "redact", JUAN)
        review("imgId", "redact", ("Zed Example", member))
        review("encId", "redact", ACME)
        review("corruptId", "redact", ACME)
        review("nodocId", "redact", ACME)

        # --- DOCX that must come out redacted: split runs, '&', header, core properties; notes, comments, tracked deletions
        make_docx = et.make_docx
        make_docx(dd / "docxId", [["Welcome to Acme ", "Youth", " Council today"],  # bare file, no directory
                                  ["Smith & Sons Ltd paid Juan Example."], ["Plain unrelated text."]],
                  header="Acme Youth Council Header", creator="Juan Example")
        make_docx(doc("absentId", "b.docx"), [["Nothing sensitive here."]])
        part = lambda tag, inner: f'<?xml version="1.0" encoding="UTF-8"?><w:{tag} {et.NS_DECL}>{inner}</w:{tag}>'
        make_docx(doc("partsId", "p.docx"), [["Plain text only."]],
                  raw_body='<w:p><w:del w:id="1"><w:r><w:delText>Juan Example</w:delText></w:r></w:del></w:p>',
                  extra={"word/footnotes.xml": part("footnotes", '<w:footnote w:id="1"><w:p><w:r><w:t>See Acme Youth Council</w:t></w:r></w:p></w:footnote>'),
                         "word/endnotes.xml": part("endnotes", '<w:endnote w:id="1"><w:p><w:r><w:t>By Juan Example</w:t></w:r></w:p></w:endnote>'),
                         "word/comments.xml": part("comments", '<w:comment w:id="1"><w:p><w:r><w:t>Acme Youth Council</w:t></w:r></w:p></w:comment>')})
        png, jpg = b"\x89PNG\r\n\x1a\n" + bytes(16), b"\xff\xd8\xff" + bytes(8)
        make_docx(doc("imgDocOk", "i.docx"), [["Welcome to Acme Youth Council"]],  # has a picture and a page-1 thumbnail
                  extra={"word/media/image1.png": png, "docProps/thumbnail.jpeg": jpg, "_rels/.rels": RELS})
        review("docxId", "redact", ACME, ("Smith & Sons Ltd", amp), JUAN)
        review("absentId", "redact", ("Nobody Here", org))  # not in a text-only document: passes trivially
        review("partsId", "redact", ACME, JUAN)
        review("imgDocOk", "redact", ACME)

        # --- DOCX that must end up confidential
        make_docx(doc("brId", "b.docx"), [["Welcome to Acme Youth", "<w:br/>", "Council today"]])  # name split by a line break
        make_docx(doc("tabId", "t.docx"), [["Welcome to Acme Youth", "<w:tab/>", "Council today"]])  # ... or a tab
        make_docx(doc("brNoteId", "bn.docx"), [["Plain text only."]],  # ... in a part extract_text does not read
                  extra={"word/footnotes.xml": part("footnotes", '<w:footnote w:id="1"><w:p><w:r><w:t>See Acme Youth</w:t><w:br/><w:t>Council</w:t></w:r></w:p></w:footnote>')})
        make_docx(doc("authorId", "a.docx"), [["Juan Example wrote this."]],
                  extra={"word/comments.xml": part("comments", '<w:comment w:id="1" w:author="Juan Example"><w:p><w:r><w:t>ok</w:t></w:r></w:p></w:comment>')})
        make_docx(doc("descrId", "d.docx"), [["Hello"]],
                  raw_body='<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="Acme Youth Council logo"/></wp:inline></w:drawing></w:r></w:p>')
        make_docx(doc("imgDocMissing", "m.docx"), [["Nothing sensitive here."]], extra={"word/media/image1.png": png})
        review("brId", "redact", ACME)
        review("tabId", "redact", ACME)
        review("brNoteId", "redact", ACME)
        review("authorId", "redact", JUAN)
        review("descrId", "redact", ACME)
        review("imgDocMissing", "redact", ACME)  # the name may be inside the picture

        # --- clean, confidential, and reviews that cannot be trusted
        make_pdf(doc("cleanId", "d.pdf"), [et.FILLER * 2])  # enough text that it is not mistaken for a scan
        make_pdf(doc("confId", "e.pdf"), [et.FILLER])
        make_pdf(doc("noReviewId", "f.pdf"), [et.FILLER])
        make_pdf(doc("badId", "g.pdf"), [et.FILLER])
        et.make_image_pdf(doc("cleanScanId", "s.pdf"), "Zed Example")
        et.make_encrypted_pdf(doc("cleanEncId", "x.pdf"))
        (dd / "multiId").mkdir()
        make_pdf(dd / "multiId" / "a.pdf", [et.FILLER])
        make_pdf(dd / "multiId" / "b.pdf", [et.FILLER])
        review("cleanId", "clean")
        review("confId", "confidential")
        for drive_id in ("cleanScanId", "cleanEncId", "multiId"):
            review(drive_id, "clean")  # a clean review of a scan, a locked file, or a directory of two files
        (reviews / "badId.json").write_text("{not json", encoding="utf-8")
        before = {p: p.read_bytes() for p in (pdf, dd / "docxId")}

        code, stdout = _run_quiet(files, reviews, out)
        verdicts = json.loads((out / "verdicts.json").read_text(encoding="utf-8"))
        v = {k: x["verdict"] for k, x in verdicts.items()}
        redacted = {"pdfId", "wrapId", "labelId", "docxId", "absentId", "partsId", "imgDocOk"}
        assert code == 0
        assert {k for k, x in v.items() if x == "redacted"} == redacted, v
        assert {k for k, x in v.items() if x == "clean"} == {"cleanId"}, v
        assert len(v) == 33 and set(v.values()) == {"redacted", "clean", "confidential"}, v
        assert stdout.strip().splitlines()[-1] == ("clean=1 redacted=7 confidential=25 failed_verification=14 "
                                                   "failed_unverifiable=2 failed_error=3 clean_demoted=3"), stdout
        assert sorted(p.name for p in out.iterdir()) == sorted(
            ["verdicts.json"] + [f"{k}.pdf" for k in ("pdfId", "wrapId", "labelId")]
            + [f"{k}.docx" for k in ("docxId", "absentId", "partsId", "imgDocOk")])
        assert all(p.read_bytes() == b for p, b in before.items()), "originals must not be touched"
        assert all(verdicts[k]["reason"] == "reviewed" for k in redacted | {"cleanId"}), "no reviewer free text for clean or redacted"

        # why each confidential one is confidential
        survived = "redaction failed: 1 string(s) survived"
        why = {k: survived for k in ("hyphId", "annotId", "annot2Id", "annot3Id", "linkId", "widgetId", "embId", "offId", "catalogId", "brId", "tabId", "brNoteId", "authorId", "descrId")}
        why |= {"imgId": "redaction failed: 1 string(s) not found", "imgDocMissing": "redaction failed: 1 string(s) not found",
               "encId": "redaction failed: ValueError", "corruptId": "redaction failed: ", "nodocId": "redaction failed: unsupported file type",
               "cleanScanId": "clean demoted: no text layer", "cleanEncId": "clean demoted: unreadable (ValueError)",
               "multiId": "clean demoted: unsupported file type", "noReviewId": "not reviewed", "badId": "invalid review",
               "confId": "r"}
        for k, prefix in why.items():
            assert v[k] == "confidential" and verdicts[k]["reason"].startswith(prefix), (k, verdicts[k])
        for k in ("hyphId", "annotId", "imgId", "encId", "cleanScanId", "cleanEncId", "noReviewId"):
            assert Path(verdicts[k]["file"]).is_file() and Path(verdicts[k]["file"]).parent.name == k, (k, verdicts[k])
        assert verdicts["multiId"]["file"] == str(dd / "multiId")  # two files: the entry itself, never uploaded
        assert verdicts["imgId"]["file"] == str((dd / "imgId" / "c.pdf").resolve())

        # has_images: true for pictures and for anything unreadable, false for plain text
        flags = {k: x["has_images"] for k, x in verdicts.items()}
        assert all(flags[k] for k in ("imgId", "imgDocOk", "imgDocMissing", "cleanScanId", "encId", "corruptId", "multiId")), flags
        assert not any(flags[k] for k in ("pdfId", "docxId", "absentId", "partsId", "cleanId", "hyphId")), flags

        # pdf: names gone from the text, bookmarks, metadata, XMP and the raw file; labels and other text stay
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
            assert not d.get_xml_metadata(), d.get_xml_metadata()
            assert [t for _, t, _ in d.get_toc()] == [f"{org} overview", "Plain heading"], d.get_toc()
        wrapped = extract(out / "wrapId.pdf", "pdf")[0]
        assert "acme" not in norm(wrapped) and "council" not in norm(wrapped) and org in wrapped, wrapped  # both lines boxed

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
        # notes, comments and a tracked deletion are scrubbed too
        with zipfile.ZipFile(out / "partsId.docx") as z:
            for name in ("word/document.xml", "word/footnotes.xml", "word/endnotes.xml", "word/comments.xml"):
                xml = z.read(name).decode("utf-8")
                assert "acme" not in norm(xml) and "juan" not in norm(xml) and ("[Client" in xml), name
                ET.fromstring(xml)
        # a picture-bearing docx is redacted but flagged; its page-1 thumbnail and the relationship to it are gone
        with zipfile.ZipFile(out / "imgDocOk.docx") as z:
            assert "docProps/thumbnail.jpeg" not in z.namelist() and "word/media/image1.png" in z.namelist()
            assert b"thumbnail" not in z.read("_rels/.rels") and ET.fromstring(z.read("_rels/.rels")) is not None
        assert extract(out / "imgDocOk.docx", "docx")[0] == f"Welcome to {org}"

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
