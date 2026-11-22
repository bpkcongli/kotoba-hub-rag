#!/usr/bin/env python3
"""Check/install repository-scoped Codex tooling without overwriting other config."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


def install(package: Path, destination: Path, write: bool) -> int:
    sources = sorted(
        path
        for folder in (".codex", ".agents")
        for path in (package / folder).rglob("*")
        if path.is_file()
    )

    if not sources:
        print("ERROR: package has no tooling files", file=sys.stderr)
        return 1

    pending: list[tuple[Path, Path]] = []
    conflicts: list[str] = []

    for source in sources:
        relative = source.relative_to(package)
        target = destination / relative

        # Refuse symlink redirection, including any existing intermediate directory.
        for part in (target, *target.parents):
            if part == destination:
                break

            if part.is_symlink():
                conflicts.append(f"symlink destination: {relative}")
                break
        else:
            conflicts.append(f"destination outside root: {relative}")

        if target.exists():
            if not target.is_file() or target.read_bytes() != source.read_bytes():
                conflicts.append(f"different existing destination: {relative}")
        else:
            pending.append((source, target))

    if conflicts:
        for conflict in sorted(set(conflicts)):
            print(f"CONFLICT: {conflict}", file=sys.stderr)

        print("No files written. Inspect and merge existing configuration explicitly.", file=sys.stderr)
        return 1

    if not write:
        print(f"Check: {len(sources)} files; {len(pending)} missing; no content conflicts.")
        print("This check does not establish filesystem writability or client discovery.")
        return 0

    try:
        for source, target in pending:
            target.parent.mkdir(parents=True, exist_ok=True)

            # Exclusive creation prevents replacing a file changed after preflight.
            with target.open("xb") as output:
                output.write(source.read_bytes())
    except OSError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        print("Installation incomplete; permissions/mounts are unchanged. Re-run check after resolving the cause.", file=sys.stderr)
        return 1

    print(f"Installed {len(pending)} files into {destination}; identical files preserved.")
    print("Open a new Codex session and verify agent/skill discovery before marking INIT-02 done.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)

    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true", help="Read-only conflict preflight")
    action.add_argument("--install", action="store_true", help="Create missing tooling files")

    parser.add_argument("--root", type=Path, help="Destination repository; defaults to this repository")
    args = parser.parse_args()

    package = Path(__file__).resolve().parent
    root = (args.root or package.parent).expanduser().resolve()

    if not root.is_dir():
        parser.error("destination repository must be an existing directory")

    return install(package, root, args.install)


if __name__ == "__main__":
    raise SystemExit(main())
