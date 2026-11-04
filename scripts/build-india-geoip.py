#!/usr/bin/env python3
"""
Builds an India-only extract of MaxMind GeoLite2-City for the State Pricing fallback (ADR-044).

Keeps only networks whose country is IN and, for each, just { country.iso_code, subdivisions[0].iso_code }. Every other
network is dropped, so a lookup for a non-Indian IP finds nothing and the store shows its default price.

    pip install maxminddb mmdb-writer
    python scripts/build-india-geoip.py GeoLite2-City.mmdb india-states.mmdb

STATUS: written against the library documentation and NOT yet run against a real GeoLite2 file. Run it once on the
real database and check the printed counts and the sample lookups before relying on it.

The output is a database derived from MaxMind data: keep it on the server (never in the public repo) and follow the
GeoLite licence and attribution terms. Point GEOIP_DB_PATH at the result.
"""
import sys
from ipaddress import ip_network

import maxminddb
from mmdb_writer import MMDBWriter


def main(src: str, dst: str) -> None:
    writer = MMDBWriter(
        ip_version=6,
        database_type="GeoLite2-City",
        languages=["en"],
        description={"en": "India-only extract of GeoLite2-City (country and first-level subdivision code)"},
        ipv4_compatible=True,
    )

    kept = 0
    without_state = 0
    seen = 0
    with maxminddb.open_database(src) as reader:
        for network, record in reader:
            seen += 1
            if not record or (record.get("country") or {}).get("iso_code") != "IN":
                continue
            subdivisions = record.get("subdivisions") or []
            state = subdivisions[0].get("iso_code") if subdivisions else None
            if not state:
                without_state += 1
                continue
            writer.insert_network(ip_network(str(network)), {"country": {"iso_code": "IN"}, "subdivisions": [{"iso_code": state}]})
            kept += 1

    writer.to_db_file(dst)
    print(f"networks read: {seen}, India networks kept: {kept}, India networks without a state: {without_state}")

    # Spot check: every kept network must read back as an Indian state.
    with maxminddb.open_database(dst) as out:
        sample = 0
        for network, record in out:
            assert record["country"]["iso_code"] == "IN"
            assert record["subdivisions"][0]["iso_code"]
            sample += 1
            if sample >= 1000:
                break
        print(f"verified {sample} records read back from {dst}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: build-india-geoip.py <GeoLite2-City.mmdb> <out.mmdb>")
    main(sys.argv[1], sys.argv[2])
