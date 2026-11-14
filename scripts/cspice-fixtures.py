"""Frozen CSPICE states for the committed DE440 snapshot.

Run from the repository root after data/kernels/de440.bsp is present:

    data/venv/bin/python scripts/cspice-fixtures.py

The venv is local and is not committed. spiceypy 8.4.0 links CSPICE N0067.
The query frame is J2000, aberration correction is NONE, and the kernel is
data/kernels/de440.bsp. On this DE440 file, NAIF frame 1 is ICRF.
"""

import hashlib
import json
from pathlib import Path

import spiceypy as spice

ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "data" / "kernels" / "de440.bsp"
GM = ROOT / "data" / "kernels" / "gm_de440.tpc"
OUT = ROOT / "tests" / "fixtures" / "de440-cspice.json"


def main() -> None:
    spice.furnsh(str(KERNEL))
    text = GM.read_text()

    def gm(name: str) -> float:
        for line in text.splitlines():
            if name in line and "=" in line:
                token = line.split("(")[1].split(")")[0].strip().replace("D", "E")
                return float(token)
        raise SystemExit(f"missing {name}")

    earth_gm = gm("BODY399_GM")
    moon_gm = gm("BODY301_GM")
    emrat = earth_gm / moon_gm
    cases = []

    def add(name: str, et: float, target: int, center: int) -> None:
        state, _ = spice.spkezr(str(target), et, "J2000", "NONE", str(center))
        cases.append(
            {
                "name": name,
                "et": et,
                "target": target,
                "center": center,
                "positionKm": list(state[:3]),
                "velocityKmps": list(state[3:]),
            }
        )

    add("j2000-moon-earth", 0.0, 301, 399)
    add("j2000-earth-ssb", 0.0, 399, 0)
    add("j2000-sun-ssb", 0.0, 10, 0)
    add("j2000-moon-emb", 0.0, 301, 3)
    add("j2000-earth-emb", 0.0, 399, 3)
    for target, name in (
        (1, "mercury-bary-ssb"),
        (2, "venus-bary-ssb"),
        (4, "mars-bary-ssb"),
        (5, "jupiter-bary-ssb"),
        (6, "saturn-bary-ssb"),
        (7, "uranus-bary-ssb"),
        (8, "neptune-bary-ssb"),
        (9, "pluto-bary-ssb"),
        (199, "mercury-ssb"),
        (299, "venus-ssb"),
    ):
        add(f"j2000-{name}", 0.0, target, 0)
    boundary = -43200.0
    add("earth-emb-before-boundary", boundary - 1, 399, 3)
    add("earth-emb-boundary", boundary, 399, 3)
    add("earth-emb-after-boundary", boundary + 1, 399, 3)
    start, stop = -1578052800.0, 1577966400.0
    add("window-start", start, 301, 399)
    add("window-start-interior", start + 1000.0, 301, 399)
    add("window-stop", stop, 301, 399)
    add("window-stop-interior", stop - 1000.0, 301, 399)
    emb, _ = spice.spkezr("3", 0.0, "J2000", "NONE", "0")
    moon, _ = spice.spkezr("301", 0.0, "J2000", "NONE", "3")
    earth, _ = spice.spkezr("399", 0.0, "J2000", "NONE", "0")
    residual = [emb[i] - moon[i] / emrat - earth[i] for i in range(6)]
    payload = {
        "kernel": "de440.bsp",
        "kernelSha256": hashlib.sha256(KERNEL.read_bytes()).hexdigest(),
        "toolkit": spice.tkvrsn("TOOLKIT"),
        "frame": "J2000",
        "abcorr": "NONE",
        "units": "km and km/s",
        "emrat": emrat,
        "emratEarthSsbResidualKm": residual,
        "note": "NAIF frame J2000 on DE440 is ICRF. No light time and no aberration. TDB seconds past J2000.",
        "cases": cases,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {OUT} residual {max(abs(v) for v in residual)}")


if __name__ == "__main__":
    main()
