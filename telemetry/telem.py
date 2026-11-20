"""Query or record real numerical channels from the current Pivot project."""
import argparse
import csv
import datetime
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlencode
import ide_telem as ide

def fetch(after=0):
    return ide.request("GET","?"+urlencode({"folder":os.getenv("PIVOT_TELEMETRY_FOLDER","."),"after":after}))

def graph(data,names):
    glyph=" .:-=+*#%@"
    for name in names:
        values=[p["value"] for p in data["samples"] if p["name"]==name]
        if not values: raise ValueError("No recent samples for "+name)
        lo,hi=min(values),max(values)
        samples=[values[int(i*(len(values)-1)/min(59,max(1,len(values)-1)))] for i in range(min(60,len(values)))]
        line="".join(glyph[round((v-lo)/(hi-lo)*9)] if hi!=lo else "=" for v in samples)
        print(f"{name} |{line}| {lo:.5g}..{hi:.5g}; last {values[-1]:.5g}")

def main():
    p=argparse.ArgumentParser(description=__doc__)
    cmd=p.add_subparsers(dest="cmd",required=True)
    cmd.add_parser("list",help="list discovered signals")
    g=cmd.add_parser("graph",help="plot recent values in the terminal")
    g.add_argument("names",nargs="+")
    r=cmd.add_parser("record",help="record recent and arriving samples to AdvantageScope CSV List")
    r.add_argument("path",nargs="?",type=Path)
    r.add_argument("--seconds",type=float,help="stop after this many seconds; otherwise Ctrl+C")
    args=p.parse_args()
    if args.cmd=="list":
        channels=fetch()["channels"]
        if not channels:print("No samples in this project.")
        for x in channels:print(f"{x['name']}\t{x['value']:.6g} {x['unit']}\t{x['t']:.6f} s")
    elif args.cmd=="graph":
        graph(fetch(),args.names)
    else:
        if args.seconds is not None and not (0 < args.seconds < 86400*31):p.error("--seconds must be between 0 and 2678400")
        path=args.path or Path("telemetry-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S")+".csv")
        cursor=0;started=time.monotonic()
        with path.open("x",encoding="utf-8",newline="") as f:
            writer=csv.writer(f,lineterminator="\n")
            writer.writerow(["Timestamp","Key","Value"])
            print(f"Recording {path.resolve()} | Ctrl+C to stop",flush=True)
            try:
                while True:
                    data=fetch(cursor)
                    for x in data["samples"]: writer.writerow([x["t"],x["name"],x["value"]])
                    if data["dropped"]:print(f"{data['dropped']} old samples fell outside the IDE history",file=sys.stderr)
                    cursor=data["cursor"];f.flush()
                    if args.seconds is not None and time.monotonic()-started>=args.seconds:break
                    time.sleep(.15)
            except KeyboardInterrupt:pass
if __name__=="__main__":
    try:main()
    except (OSError,ValueError) as e:sys.exit(str(e))
