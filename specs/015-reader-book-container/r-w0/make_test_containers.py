"""R-W0 (specs/015-reader-book-container): test containers for the iPad check of the `.polenuk` extension.

  python3 -I make_test_containers.py OUT_DIR PACKAGE.reader.json AUDIO_DIR [PACKAGE2 AUDIO_DIR2 ...]

For each package writes `<name>.polenuk` and `<name>.zip` with the same bytes, laid out by the container contract v1
(spec.md): `mimetype` first and stored, `container.json`, `book.reader.json`, `audio/<name>` stored. Only for the
check of Files, AirDrop, iCloud Drive and the file picker; the Reader app does not import containers yet.
The packages and MP3s are taken as they are; nothing is downloaded. Output stays outside git.
"""
import hashlib
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

MIMETYPE = b"application/vnd.reader-book+zip"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def container(out_dir: Path, package: Path, audio_dir: Path) -> list[Path]:
    pkg = json.loads(package.read_text(encoding="utf-8"))
    audio = []
    for track in pkg["tracks"]:
        path = audio_dir / track["name"]
        if path.stat().st_size != track["size"] or sha256(path) != track["sha256"]:
            raise SystemExit(f"{path.name}: not the audio of the package")
        audio.append({"path": f"audio/{track['name']}", "size": track["size"], "sha256": track["sha256"], "file": path})
    meta = {"format": "reader-book-container", "version": 1, "package": "book.reader.json",
            "audio": [{k: a[k] for k in ("path", "size", "sha256")} for a in audio],
            "generator": {"name": "r-w0 make_test_containers.py", "version": 1},
            "created": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    base = out_dir / f"{package.name.removesuffix('.reader.json')}-{pkg['language']}"
    made = []
    for suffix in (".polenuk", ".zip"):
        target = base.with_suffix(suffix)
        with zipfile.ZipFile(target, "w") as z:
            z.writestr(zipfile.ZipInfo("mimetype"), MIMETYPE, compress_type=zipfile.ZIP_STORED)
            z.writestr("container.json", json.dumps(meta, ensure_ascii=False, indent=1), compress_type=zipfile.ZIP_DEFLATED)
            z.write(package, "book.reader.json", compress_type=zipfile.ZIP_DEFLATED)
            for a in audio:
                z.write(a["file"], a["path"], compress_type=zipfile.ZIP_STORED)
        made.append(target)
    return made


if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    args = sys.argv[2:]
    for i in range(0, len(args), 2):
        for path in container(out, Path(args[i]), Path(args[i + 1])):
            print(path, path.stat().st_size)
