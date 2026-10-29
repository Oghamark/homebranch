"""Package original test sources as an EPUB without generated repository files."""
import pathlib
import sys
import zipfile

source = pathlib.Path(__file__).parent / "fixtures" / "epub"
with zipfile.ZipFile(sys.argv[1], "w") as archive:
    archive.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
    for path in sorted(source.rglob("*")):
        if path.is_file():
            entry = zipfile.ZipInfo(path.relative_to(source).as_posix())
            archive.writestr(entry, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
