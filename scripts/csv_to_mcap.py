"""Convert a numeric AdvantageScope CSV table to an indexed MCAP on simulation time."""

import argparse
import csv
from decimal import Decimal, InvalidOperation, localcontext
import json
import math
from pathlib import Path
import os
import tempfile
from itertools import zip_longest
try:
    from mcap.writer import Writer, CompressionType
    from mcap.reader import make_reader
except ModuleNotFoundError as exc:
    raise SystemExit("Install simulator/mcap-requirements.txt in the Hinge Python environment.") from exc

TOPIC = "/hinge/telemetry"


def samples(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = csv.reader(stream, strict=True)
        fields = next(rows, [])
        if (
            len(fields) < 2
            or fields[0] != "Timestamp"
            or len(set(fields)) != len(fields)
            or not all(fields)
        ):
            raise ValueError(
                "Expected Timestamp followed by unique, named numeric signal columns."
            )
        yield fields
        prev = -1
        for line, row in enumerate(rows, 2):
            if len(row) != len(fields):
                raise ValueError(f"Line {line} has the wrong number of columns.")
            seconds = Decimal(row[0])
            if (
                not seconds.is_finite()
                or not 0 <= seconds < Decimal(2**64) / 10**9
                or 0 < seconds < Decimal("1e-9")
            ):
                raise ValueError(f"Invalid timestamp on line {line}.")
            with localcontext() as ctx:
                ctx.prec = max(40, len(seconds.as_tuple().digits) + 10)
                ns = seconds * 10**9
            if ns != ns.to_integral_value() or ns < prev:
                raise ValueError(
                    f"Line {line} needs nondecreasing timestamps with nanosecond precision or coarser."
                )
            prev = int(ns)
            payload = dict(zip(fields, map(float, row)))
            if not all(map(math.isfinite, payload.values())):
                raise ValueError(f"Nonfinite signal on line {line}.")
            yield prev, payload


def convert(source, overwrite=False):
    source = Path(source).resolve(strict=True)
    if source.suffix.lower() != ".csv":
        raise ValueError("Input must have a .csv extension.")
    dest = source.with_suffix(".mcap")
    if dest.exists() and not overwrite:
        raise ValueError(f"{dest.name} already exists. Use --force to replace it.")
    records = samples(source)
    fields = next(records)
    schema = {
        "type": "object",
        "properties": {f: {"type": "number"} for f in fields},
        "required": fields,
        "additionalProperties": False,
    }
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=dest.parent, delete=False, suffix=".tmp"
        ) as out:
            tmp = Path(out.name)
            writer = Writer(
                out, compression=CompressionType.ZSTD, enable_data_crcs=True
            )
            writer.start(library="hinge")
            schema_id = writer.register_schema(
                "HingeTelemetry", "jsonschema", json.dumps(schema).encode()
            )
            channel = writer.register_channel(
                TOPIC,
                "json",
                schema_id,
                {"clock": "simulation seconds from CSV Timestamp"},
            )
            count = 0
            for ns, payload in records:
                writer.add_message(
                    channel,
                    ns,
                    json.dumps(payload, separators=(",", ":")).encode(),
                    ns,
                    count,
                )
                count += 1
            if not count:
                raise ValueError("CSV has no samples.")
            writer.finish()
        with tmp.open("rb") as stream:
            back = make_reader(stream, validate_crcs=True).iter_messages(
                log_time_order=False
            )
            original = samples(source)
            if next(original) != fields:
                raise ValueError("CSV header changed during conversion.")
            for index, (sample, entry) in enumerate(zip_longest(original, back)):
                if sample is None or entry is None:
                    raise ValueError("MCAP verification found a row-count mismatch.")
                ns, payload = sample
                _, chan, msg = entry
                if (
                    chan.topic,
                    msg.sequence,
                    msg.log_time,
                    msg.publish_time,
                    json.loads(msg.data),
                ) != (TOPIC, index, ns, ns, payload):
                    raise ValueError(f"MCAP verification failed on sample {index}.")
        if overwrite:
            os.replace(tmp, dest)
        elif os.name == "nt":
            os.rename(tmp, dest)  # Windows rename refuses an existing destination.
        else:
            os.link(
                tmp, dest
            )  # Atomically publish without overwriting a concurrent conversion.
        return dest, count
    finally:
        records.close()
        if tmp:
            tmp.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument(
        "--force",
        action="store_true",
        help="replace an existing sibling MCAP after verification",
    )
    args = parser.parse_args()
    try:
        output, count = convert(args.csv, args.force)
        print(f"{count} samples verified\n{output}")
    except (ValueError, OSError, InvalidOperation, csv.Error) as exc:
        parser.exit(1, f"Conversion failed: {exc}\n")
