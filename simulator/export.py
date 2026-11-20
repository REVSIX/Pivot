"""Run a bounded MuJoCo batch from a terminal or the headless Compose service."""
import argparse
import csv
from pathlib import Path
from run import simulate

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--force", action="store_true")
    args=parser.parse_args()
    if args.output.suffix.lower()!=".csv":parser.error("output must end in .csv")
    with args.model.open("rb") as src:
        capture=simulate(src.read(65537))
    with args.output.open("w" if args.force else "x",encoding="utf-8",newline="") as dst:
        writer=csv.writer(dst,lineterminator="\n")
        writer.writerow(["Timestamp",*(key for i,_ in enumerate(capture["joints"]) for key in (f"/Sim/qpos/{i}",f"/Sim/qvel/{i}"))])
        for f in capture["frames"]:
            writer.writerow([f["t"],*(value for pair in zip(f["q"],f["v"]) for value in pair)])
    print(f"{len(capture['frames'])} samples | {args.output.resolve()}")

if __name__=="__main__":
    main()
