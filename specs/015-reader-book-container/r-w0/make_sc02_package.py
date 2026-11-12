"""SC-02 (specs/015-reader-book-container): a synthetic prepared book of 2 MP3 × ~100 MB for the iPad check of a large
container — two sine tones made by a local ffmpeg (no speech, no third-party material, nothing downloaded), a text of
one timed sentence every 10 s with its Ukrainian translation. Then make_test_containers.py packs it unchanged.

  python3 -I make_sc02_package.py OUT_DIR LANGUAGE [FFMPEG]     # LANGUAGE: en or pl

Output (outside git): OUT_DIR/sc02-2x100mb.reader.json and OUT_DIR/audio/part-1.mp3, part-2.mp3.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

SECONDS = 2560          # at 320 kbit/s ≈ 102 MB per track
STEP = 10               # one sentence every 10 s
TEXT = {
    "en": ("Part {k}", "This is sentence {n} of part {k}."),
    "pl": ("Część {k}", "To jest zdanie {n} części {k}."),
}
TRANSLATION = "Це речення {n} частини {k}."


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(out: Path, language: str, ffmpeg: str) -> None:
    title, sentence = TEXT[language]
    audio = out / "audio"
    audio.mkdir(parents=True, exist_ok=True)
    chapters, tracks, translations, sync = [], [], {}, {}
    for k, hz in ((1, 440), (2, 660)):
        mp3 = audio / f"part-{k}.mp3"
        if not mp3.exists():
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                            f"sine=frequency={hz}:duration={SECONDS}", "-ac", "2", "-ar", "44100", "-b:a", "320k",
                            str(mp3)], check=True)
        tracks.append({"id": f"t{k}", "name": mp3.name, "size": mp3.stat().st_size, "sha256": sha256(mp3)})
        count = SECONDS // STEP - 1
        paragraphs = [{"kind": "text", "sentences": [sentence.format(n=n, k=k)]} for n in range(1, count + 1)]
        chapters.append({"title": title.format(k=k), "paragraphs": paragraphs})
        c = k - 1
        for p in range(count):
            translations[f"{c}-{p}"] = [TRANSLATION.format(n=p + 1, k=k)]
            sync[f"{c}-{p}"] = [[f"t{k}", p * STEP + 1, p * STEP + 9]]
    canonical = [[c["title"], [[p["kind"], p["sentences"]] for p in c["paragraphs"]]] for c in chapters]
    edition = hashlib.sha256(json.dumps(canonical, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    pkg = {"format": "reader-book", "version": 1, "packageId": f"sc02-{language}", "edition": edition,
           "language": language, "translationLanguage": "uk",
           "book": {"title": f"SC-02 2×100 MB ({language})", "author": "Test", "format": "txt", "chapters": chapters},
           "translations": translations, "tracks": tracks, "sync": sync}
    path = out / "sc02-2x100mb.reader.json"
    path.write_text(json.dumps(pkg, ensure_ascii=False), encoding="utf-8")
    print(path, [t["size"] for t in tracks])


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "ffmpeg")
