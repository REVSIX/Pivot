"""Write the current SDK telemetry snapshot as MCAP on standard output."""

from decimal import Decimal
import json
import sys

from mcap.writer import CompressionType, Writer


def main():
    samples = json.load(sys.stdin, parse_float=Decimal)
    records = []
    for sample in samples:
        nanoseconds = round(sample["t"] * 10**9)
        if not 0 <= nanoseconds < 2**64:
            raise ValueError("Telemetry timestamp is outside MCAP's 64-bit range.")
        payload = {
            "timestamp": float(sample["t"]),
            "key": sample["name"],
            "value": float(sample["value"]),
            "unit": sample["unit"],
        }
        records.append((nanoseconds, payload))

    writer = Writer(sys.stdout.buffer, compression=CompressionType.NONE, enable_data_crcs=True)
    writer.start(library="pivot")
    schema = writer.register_schema(
        "PivotTelemetryPoint",
        "jsonschema",
        b'{"type":"object","properties":{"timestamp":{"type":"number"},"key":{"type":"string"},'
        b'"value":{"type":"number"},"unit":{"type":"string"}},"required":["timestamp","key","value","unit"]}',
    )
    channel = writer.register_channel("/pivot/telemetry", "json", schema)
    for timestamp, payload in sorted(records, key=lambda record: record[0]):
        writer.add_message(channel, timestamp, json.dumps(payload, separators=(",", ":")).encode(), timestamp)
    writer.finish()


if __name__ == "__main__":
    main()
