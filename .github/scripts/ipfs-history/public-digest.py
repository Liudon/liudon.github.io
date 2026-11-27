#!/usr/bin/env python3
"""Compute a deterministic SHA-256 digest of a static site directory."""

from pathlib import Path
import hashlib
import sys


def compute_digest(root: Path) -> str:
    h = hashlib.sha256()

    def add_field(tag: bytes, value: bytes) -> None:
        h.update(tag)
        h.update(len(value).to_bytes(8, "big"))
        h.update(value)

    entries = sorted(
        root.rglob("*"),
        key=lambda p: p.relative_to(root).as_posix(),
    )

    for path in entries:
        rel = path.relative_to(root).as_posix().encode("utf-8")

        if path.is_symlink():
            add_field(b"L", rel)
            add_field(b"T", path.readlink().as_posix().encode("utf-8"))
        elif path.is_dir():
            add_field(b"D", rel)
        elif path.is_file():
            add_field(b"F", rel)
            with path.open("rb") as f:
                while chunk := f.read(1024 * 1024):
                    h.update(chunk)
        else:
            raise SystemExit(f"Unsupported filesystem entry: {path}")

    return "sha256:" + h.hexdigest()


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "public")
    print(compute_digest(target))
