import sys
import tempfile
from pathlib import Path
import unittest
from mcap.reader import make_reader

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from csv_to_mcap import convert


class ConversionTest(unittest.TestCase):
    def test_exact_timeline_and_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "robot run.csv"
            source.write_text("Timestamp,a\n0.000000001,-2\n3.125000001,4.5\n")
            dest, rows = convert(source)
            self.assertEqual(rows, 2)
            with dest.open("rb") as f:
                messages = [record[2] for record in make_reader(f).iter_messages()]
                self.assertEqual([m.log_time for m in messages], [1, 3125000001])
                self.assertEqual([m.publish_time for m in messages], [1, 3125000001])
            with self.assertRaises(ValueError):
                convert(source)
            before = dest.read_bytes()
            source.write_text("Timestamp,a\n1,1\n0,2\n")
            with self.assertRaises(ValueError):
                convert(source, overwrite=True)
            self.assertEqual(dest.read_bytes(), before)

    def test_malformed_timestamp_and_signal(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "bad.csv"
            for row in ["0.0000000001,1", "0,NaN", "-1,2", "NaN,2", "0,1,2"]:
                source.write_text("Timestamp,x\n" + row + "\n")
                with self.assertRaises(ValueError):
                    convert(source)
                self.assertFalse(source.with_suffix(".mcap").exists())
