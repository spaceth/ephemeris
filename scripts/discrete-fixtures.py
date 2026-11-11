"""Freeze CSPICE states for SPK types 8, 9, 12, and 13.

Run from the repository root:

    data/venv/bin/python scripts/discrete-fixtures.py

The script writes tests/fixtures/discrete.bsp and tests/fixtures/discrete-cspice.json.
The test suite reads those files and does not call CSPICE.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import spiceypy

ROOT = Path(__file__).resolve().parents[1]
BSP = ROOT / "tests" / "fixtures" / "discrete.bsp"
OUT = ROOT / "tests" / "fixtures" / "discrete-cspice.json"


def state_at(t: float, scale: float) -> list[float]:
    x = 7000.0 + 1.5 * t + 1e-4 * t * t
    y = scale * np.sin(t / 200.0)
    z = 200.0 * np.cos(t / 300.0)
    vx = 1.5 + 2e-4 * t
    vy = scale / 200.0 * np.cos(t / 200.0)
    vz = -200.0 / 300.0 * np.sin(t / 300.0)
    return [float(x), float(y), float(z), float(vx), float(vy), float(vz)]


def equal_states(epoch0: float, step: float, count: int, scale: float) -> np.ndarray:
    rows = [state_at(epoch0 + i * step, scale) for i in range(count)]
    return np.array(rows, dtype=np.float64)


def write() -> None:
    if BSP.exists():
        BSP.unlink()
    handle = spiceypy.spkopn(str(BSP), "discrete", 0)
    # Type 8, body -510, center Earth. A later overlapping segment wins.
    early = equal_states(0.0, 60.0, 16, 800.0)
    spiceypy.spkw08(handle, -510, 399, "J2000", 0.0, 15 * 60.0, "type 8 early", 3, early.shape[0], early, 0.0, 60.0)
    late = equal_states(400.0, 60.0, 10, 1200.0)
    spiceypy.spkw08(handle, -510, 399, "J2000", 400.0, 400.0 + 9 * 60.0, "type 8 late", 3, late.shape[0], late, 400.0, 60.0)
    # Type 9, unequal epochs.
    epochs = np.array([0, 10, 30, 60, 100, 150, 210, 280, 360, 450, 550, 660], dtype=np.float64)
    type9 = np.array([state_at(float(t), 500.0) for t in epochs], dtype=np.float64)
    spiceypy.spkw09(handle, -511, 399, "J2000", float(epochs[0]), float(epochs[-1]), "type 9", 3, type9.shape[0], type9, epochs)
    # Type 12, degree 7, even window of 4.
    type12 = equal_states(0.0, 30.0, 20, 900.0)
    spiceypy.spkw12(handle, -512, 399, "J2000", 0.0, 19 * 30.0, "type 12", 7, type12.shape[0], type12, 0.0, 30.0)
    # Type 13, degree 3, window of 2.
    epochs13 = np.array([0, 20, 50, 90, 140, 200, 270, 350], dtype=np.float64)
    type13 = np.array([state_at(float(t), 400.0) for t in epochs13], dtype=np.float64)
    spiceypy.spkw13(handle, -513, 399, "J2000", float(epochs13[0]), float(epochs13[-1]), "type 13", 3, type13.shape[0], type13, epochs13)
    spiceypy.spkcls(handle)


def sample(body: int, epochs: list[float]) -> list[dict]:
    cases = []
    for et in epochs:
        state, _ = spiceypy.spkezr(str(body), et, "J2000", "NONE", "399")
        cases.append({"body": body, "center": 399, "et": et, "stateKm": [float(v) for v in state]})
    return cases


def main() -> None:
    write()
    spiceypy.furnsh(str(BSP))
    cases = []
    cases += sample(-510, [0.0, 30.0, 60.0, 399.0, 400.0, 430.0, 940.0])
    cases += sample(-511, [0.0, 5.0, 30.0, 100.0, 500.0, 660.0])
    cases += sample(-512, [0.0, 15.0, 30.0, 45.0, 300.0, 570.0])
    cases += sample(-513, [0.0, 10.0, 20.0, 70.0, 200.0, 350.0])
    spiceypy.unload(str(BSP))
    OUT.write_text(
        json.dumps(
            {
                "kernel": "tests/fixtures/discrete.bsp",
                "command": "data/venv/bin/python scripts/discrete-fixtures.py",
                "abcorr": "NONE",
                "frame": "J2000",
                "cases": cases,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {BSP} and {len(cases)} cases")


if __name__ == "__main__":
    main()
