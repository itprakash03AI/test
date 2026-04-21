#!/usr/bin/env python3
"""Download DuckDB extensions for offline/air-gapped Docker builds.

Run this script on a machine WITH internet access. It downloads the
Linux amd64 extensions matching the installed DuckDB version and saves
them in the correct directory structure so Docker can COPY them directly
into the image — no INSTALL needed at build or runtime.

Usage:
    python duckdb_extensions/download_extensions.py
    python duckdb_extensions/download_extensions.py --version 1.1.3
    python duckdb_extensions/download_extensions.py --platform linux_amd64_gcc4

Output structure:
    duckdb_extensions/
    ├── v{VERSION}/
    │   └── linux_amd64/
    │       ├── httpfs.duckdb_extension
    │       ├── excel.duckdb_extension
    │       └── iceberg.duckdb_extension
    └── download_extensions.py  (this script)

The Dockerfile COPY step places these into the container's extension
directory.  DuckDB's LOAD command finds them without INSTALL.
"""
import argparse
import gzip
import os
import sys
import urllib.request

# ── Configuration ─────────────────────────────────────────────────────────────

# Target platform for Docker containers (python:3.11-slim = Debian amd64)
DEFAULT_PLATFORM = "linux_amd64"

# Extensions required by QueryStudio
EXTENSIONS = ["httpfs", "excel", "iceberg"]

# DuckDB extension download base URL (http, not https — matches DuckDB's own URLs)
BASE_URL_TEMPLATE = "http://extensions.duckdb.org/v{version}/{platform}"


def _detect_duckdb_version() -> str:
    """Auto-detect installed DuckDB version."""
    try:
        import duckdb
        return duckdb.__version__
    except ImportError:
        return ""


def main():
    parser = argparse.ArgumentParser(description="Download DuckDB extensions for offline Docker builds")
    parser.add_argument("--version", default="", help="DuckDB version (auto-detected if omitted)")
    parser.add_argument("--platform", default=DEFAULT_PLATFORM, help=f"Target platform (default: {DEFAULT_PLATFORM})")
    args = parser.parse_args()

    version = args.version or _detect_duckdb_version()
    if not version:
        print("ERROR: Could not detect DuckDB version. Install duckdb or pass --version")
        sys.exit(1)

    platform = args.platform
    base_url = BASE_URL_TEMPLATE.format(version=version, platform=platform)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(script_dir, f"v{version}", platform)
    os.makedirs(out_dir, exist_ok=True)

    print(f"DuckDB version : {version}")
    print(f"Platform       : {platform}")
    print(f"Output dir     : {out_dir}")
    print(f"Extensions     : {', '.join(EXTENSIONS)}")
    print(f"Base URL       : {base_url}")
    print()

    success_count = 0
    for ext in EXTENSIONS:
        # DuckDB serves extensions as gzipped files
        url = f"{base_url}/{ext}.duckdb_extension.gz"
        gz_path = os.path.join(out_dir, f"{ext}.duckdb_extension.gz")
        ext_path = os.path.join(out_dir, f"{ext}.duckdb_extension")

        print(f"Downloading {ext}...")
        print(f"  URL: {url}")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "DuckDB"})
            with urllib.request.urlopen(req) as resp, open(gz_path, "wb") as out:
                out.write(resp.read())
            gz_size = os.path.getsize(gz_path)
            print(f"  Downloaded: {gz_size:,} bytes (compressed)")

            # Decompress — DuckDB LOAD expects uncompressed .duckdb_extension
            with gzip.open(gz_path, "rb") as f_in:
                data = f_in.read()
            with open(ext_path, "wb") as f_out:
                f_out.write(data)
            ext_size = os.path.getsize(ext_path)
            print(f"  Extracted:  {ext_size:,} bytes")

            # Remove compressed file — only need the uncompressed one
            os.remove(gz_path)
            print(f"  OK")
            success_count += 1
        except Exception as e:
            print(f"  FAILED: {e}")
            print(f"  You can manually download from: {url}")
            # Clean up partial downloads
            for p in (gz_path, ext_path):
                if os.path.exists(p):
                    os.remove(p)
        print()

    print(f"Downloaded {success_count}/{len(EXTENSIONS)} extensions")
    if success_count > 0:
        print(f"Files are in: {out_dir}")
    print()
    print("Next steps:")
    print("  1. git add duckdb_extensions/ && git commit")
    print("  2. Docker build will COPY these into the image (no internet needed)")
    print("  3. DuckDB LOAD will find them in extension_directory")


if __name__ == "__main__":
    main()
