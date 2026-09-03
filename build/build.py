#!/usr/bin/env python3
"""Assemble the single self-contained index.html.

Inlines the vendored jsPDF UMD build and four base64 TTFs into
src/index.template.html. This runs once, here; the shipped index.html needs
no build step, no npm and no network at runtime.
"""
import base64, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FONTS = {
    "__B64_EXO2_REGULAR__":  "vendor/fonts/Exo2-Regular.ttf",
    "__B64_EXO2_BOLD__":     "vendor/fonts/Exo2-Bold.ttf",
    "__B64_EXO2_ITALIC__":   "vendor/fonts/Exo2-Italic.ttf",
    "__B64_ORBITRON_BOLD__": "vendor/fonts/Orbitron-Bold.ttf",
}
JSPDF = "vendor/jspdf/jspdf.umd.min.js"
TEMPLATE = "src/index.template.html"
OUTPUT = "index.html"


def read(path, mode="r"):
    with open(os.path.join(ROOT, path), mode) as fh:
        return fh.read()


def main():
    html = read(TEMPLATE)

    js = read(JSPDF)
    # Inlining into <script> would break on a literal closing tag or on a
    # comment sequence that ends the script element early.
    for bad in ("</script", "<!--"):
        if bad in js:
            sys.exit("vendored jsPDF contains %r and cannot be inlined verbatim" % bad)
    html = html.replace("__JSPDF_UMD__", js)

    for token, path in FONTS.items():
        b64 = base64.b64encode(read(path, "rb")).decode("ascii")
        html = html.replace(token, b64)

    for token in list(FONTS) + ["__JSPDF_UMD__"]:
        if token in html:
            sys.exit("placeholder %s was not substituted" % token)

    out = os.path.join(ROOT, OUTPUT)
    with open(out, "w") as fh:
        fh.write(html)
    print("wrote %s (%.1f KB)" % (OUTPUT, os.path.getsize(out) / 1024.0))


if __name__ == "__main__":
    main()
