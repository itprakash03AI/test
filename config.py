"""
QueryStudio — centralised configuration loader.

Resolution order (highest → lowest priority):
  1. Environment variables  (QUERYSTUDIO_<SECTION>_<KEY>  e.g. QUERYSTUDIO_SERVER_PORT)
  2. config.json            (backend/config.json)
  3. Built-in defaults      (hardcoded in this file)

For OpenShift / container deployments set env vars in the Deployment manifest or
a ConfigMap/Secret — no code changes required.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from core.roles import ADMIN_TIER_ROLES

logger = logging.getLogger(__name__)

# config.json lives next to main.py (backend/)
_CONFIG_FILE = Path(__file__).resolve().parent.parent / "config.json"

# ── Built-in defaults (fallback when neither env var nor config.json provides a value) ──
_DEFAULTS: dict = {
    "database": {
        "type": "sqlite",           # "sqlite" | "postgresql" | "oracle"
        "postgresql_url": "",       # "postgresql://user:pass@host:5432/querystudio"
        "postgresql_pool_size": 20,
        "postgresql_max_overflow": 30,
        "postgresql_pool_timeout": 30,
        "postgresql_ssl_mode": "prefer",  # disable, allow, prefer, require, verify-ca, verify-full
        "oracle_dsn": "",
        "oracle_user": "",
        "oracle_password": "",
        # Read replica settings (Phase 43)
        "replica_urls": [],                    # list of PostgreSQL replica URLs
        "read_preference": "replica",          # "primary" | "replica" | "primary_preferred"
        "replica_pool_size": 10,
        "replica_max_overflow": 15,
        "replica_pool_timeout": 20,
        "replica_health_interval_seconds": 30,
        "replica_max_lag_seconds": 5,
    },
    "auth": {
        "type": "none",             # "none" | "ad" | "local"
        "local_users": "",          # "user1:pass1,user2:pass2" format
        "user_roles": "",           # "user1:admin,user2:analyst,user3:viewer"
        "ad_server": "",
        "ad_domain": "",
        "ad_base_dn": "",
        "ad_user_search_filter": "(sAMAccountName={username})",
        "ad_group_attribute": "memberOf",
        "ad_admin_groups": "",
        "ad_analyst_groups": "",
        "ad_viewer_groups": "",
        "ad_service_account": "",   # Service account for LDAP lookups (e.g. "CN=svc_qs,OU=Service,DC=example,DC=com")
        "ad_service_password": "",  # Service account password
        "ad_connect_timeout": 3,    # seconds to wait for LDAP socket connect (0 = no limit); was 10, lowered to fail fast
        "ad_receive_timeout": 10,   # seconds to wait for LDAP response after connect
        "ad_use_ssl": False,        # True for ldaps:// connections (port 636)
        "ad_tls_validate": True,    # Validate server TLS cert (set False for self-signed certs in dev)
        "ad_tls_check_hostname": False,  # Verify cert CN/SAN matches ad_server hostname.
                                    # Default False because AD certs are typically issued to the DC's FQDN
                                    # (e.g. dc01.corp.example.com) not the domain (corp.example.com).
                                    # Set True only if your AD cert has SANs matching the ad_server hostname.
        "ad_tls_ca_file": "",       # PEM CA bundle for AD server cert. Empty = use OS default trust store.
                                    # Set to a mounted file path (e.g. "/app/certs/ad-ca/ca.crt") when the
                                    # AD server uses an internal CA not in the image's trust store.
    },
    "server": {
        "host": "0.0.0.0",
        "port": 8000,
        "log_level": "info",
        "log_format": "json",       # "json" (structured, for ELK/Splunk) | "text" (human-readable)
        "log_file": "",             # Path to log file. Empty = stdout only. e.g. "logs/querystudio.log"
        "log_retention_days": 2,    # delete rotated log files older than N days (0 = keep forever)
        "otel_endpoint": "",        # OpenTelemetry OTLP endpoint e.g. "http://jaeger:4317" (empty = disabled)
        "workers": 1,
        # TLS / HTTPS — set ssl_certfile + ssl_keyfile to serve HTTPS directly.
        # For production, prefer terminating TLS at a reverse proxy (nginx/Caddy).
        "ssl_certfile": "",         # Path to PEM cert file  e.g. "certs/cert.pem"
        "ssl_keyfile": "",          # Path to PEM key file   e.g. "certs/key.pem"
        "ssl_keyfile_password": "", # Key passphrase (if encrypted private key)
        "https_redirect": False,    # True → redirect all plain HTTP requests to HTTPS
    },
    "paths": {
        "data_dir": "data",
        "parquet_dir": "data/parquet",
        "downloads_dir": "data/downloads",
        "db_file": "data/parquet_query_engine.db",
        "secret_key_file": "data/secret.key",
        "upload_dir": "data/uploads",
        "duckdb_temp_dir": "data/tmp/duckdb",
        "download_temp_dir": "data/tmp/downloads",
    },
    "query_engine": {
        "chunk_size": 100000,
        "max_workers": 0,
        "query_timeout_seconds": 1800,     # 30 min; 0 = no limit
        "max_concurrent_per_user": 10,     # max parallel queries per user
        "max_concurrent_global": 50,       # system-wide max active queries
        "max_queue_size": 100,             # max queries waiting in queue
        "duckdb_threads_per_query": 4,     # threads per DuckDB query; 0 = auto (cpu_count / 4, min 2)
        "duckdb_memory_limit_mb": 2048,    # per-query memory cap in MB (2GB default); 0 = unlimited
    },
    "s3": {
        "default_region": "us-east-1",
        "handler_cache_ttl_seconds": 2700,  # 45 min — STS tokens expire at 60 min
        "default_onprem_access_mode": "presigned",  # "presigned" (boto3 pre-signs, safe for hive partitions) or "native" (DuckDB S3 creds)
        "parallel_download_workers": 8,     # threads for parallel presigned URL signing + file downloads
    },
    "s3_results": {
        "enabled": False,                     # upload large results to S3 (requires S3_BUCKET_NAME env)
        "storage_mode": "local",              # "local" = always local, "s3" = always S3, "auto" = S3 above threshold
        "size_threshold_mb": 10,              # results larger than this get uploaded to S3 (auto mode only)
        "prefix": "querystudio/results/",     # S3 key prefix for result files
        "delete_local_after_upload": False,    # remove local parquet after S3 upload
        "bucket_override": "",                # use a different bucket for results (empty = use default S3 bucket)
    },
    "scheduler": {
        "cleanup_temp_files_hours": 1,
        "max_missed_jobs": 3,
        "execution_retention_days": 30,   # delete execution history older than N days
        "mode": "embedded",               # "embedded" (in-process) | "external" (separate worker)
        "worker_port": 8001,              # internal API port for scheduler_worker.py
        "worker_host": "127.0.0.1",       # bind address for scheduler_worker.py
        "notification_poll_interval": 1.5, # seconds between DB notification polls
        "job_pool_size": 20,              # max concurrent APScheduler jobs (reported in heartbeat)
    },
    "storage": {
        "max_cache_size_mb":     2048,    # LRU-evict cache when total exceeds this
        "max_downloads_size_mb": 10240,   # warn/evict downloads when total exceeds this
        "downloads_expiry_days": 7,       # default download file TTL
    },
    "cors": {
        "allow_origins": ["*"],
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    },
    "email": {
        "host": "",
        "port": 587,
        "user": "",
        "password": "",
        "from_address": "",
        "use_tls": True,
    },
    "cache": {
        "enabled":             True,
        "ttl_seconds":         3600,
        "max_size_mb":         2048,
        "download_ttl_seconds": 604800,   # 7 days — download file retention (Phase 102-H)
        # Phase 104 — Partition-aware cache invalidation
        "partition_aware_invalidation": True,  # master toggle for staleness checks
        "snapshot_check_ttl_seconds":   300,   # L1 TTL — how often to re-check per table (5 min)
        "snapshot_sweep_interval_hours": 2,    # background sweep frequency
        "parquet_file_list_check":      True,  # track plain-parquet file count/hash changes
    },
    "worker_pool": {
        "total_workers":               40,
        "drain_timeout_seconds":       15,
        "interactive_max_concurrent":  30,
        "interactive_default_timeout": 1800,
        "interactive_max_queue":       100,
        "report_max_concurrent":       10,
        "report_default_timeout":      3600,
        "report_max_queue":            20,
        "scheduled_max_concurrent":    5,
        "scheduled_default_timeout":   7200,
        "scheduled_max_queue":         50,
        "export_max_concurrent":       8,
        "export_default_timeout":      900,
        "export_max_queue":            30,
        "system_max_concurrent":       10,
        "system_default_timeout":      300,
        "system_max_queue":            50,
    },
    "limits": {
        "max_stream_files":            200,     # max S3 parquet files per streaming query
        "stream_query_limit_default":  500,     # default row limit for stream queries
        "stream_query_limit_max":      5000,    # max row limit for stream queries
        "stream_page_size_default":    100,     # default page size for stream pagination
        "stream_page_size_max":        5000,    # max page size for stream pagination
        "stream_chart_top_n":          50,      # max rows for streaming chart aggregation
        "stream_chart_max_series":     10,      # max series in multi-series streaming chart
        "max_upload_size_mb":          1024,    # max file upload size in MB (1 GB)
        "max_display_cols":            50,      # default visible columns in grid (user can add/remove)
        "col_auto_project":            50,      # query builder auto-select threshold for wide tables
        "default_query_limit":         1000,    # default query result row limit
        "streaming_default_on":        False,   # default state of streaming toggle
        "stream_bg_download_default":  True,    # default state of background download toggle
        "error_message_max_length":    300,     # truncate long error strings (Phase 102-H)
        "metadata_cache_ttl":          7200,    # data_grid metadata cache TTL (Phase 102-H)
    },
    "query_guardrails": {
        "enabled":                      True,       # master toggle for all guardrails
        "max_files_warn":               50,         # show warning if file count exceeds this
        "max_files_block":              200,        # block execution if file count exceeds this (0=no limit)
        "max_rows_warn":                10000000,   # 10M rows — show warning
        "max_rows_block":               100000000,  # 100M rows — block execution (0=no limit)
        "require_partition_filter":     False,      # block if partitioned table has no partition selected
        "warn_no_partition":            True,       # warn if partitions available but none selected
        "warn_no_limit":                True,       # warn if no LIMIT set
        "default_limit_suggestion":     1000,       # suggested LIMIT value shown in warning
        # ── Phase 107-B: detection-first S3 partition pruning ──
        "s3_full_scan_action":          "log",      # "log" | "warn" | "block" — default log = zero behavior change
        "s3_full_scan_min_files":       50,         # post-exec: only flag if scanned files exceeds this
        "post_exec_detection":          True,       # also log inside register_s3_views() after the fact
    },
    "materialized_views": {
        "storage_dir":              "data/materialized",
        "max_size_mb":              10240,       # 10 GB total for all MVs
        "max_views":                50,
        "refresh_timeout_seconds":  3600,        # 1 hour max refresh time
        "chunk_size":               500000,      # rows per output parquet file
    },
    "federation_views": {
        "storage_dir":              "data/federation_views",
        "max_nesting_depth":        3,           # max view-to-view reference depth
        "materialization_timeout":  1800,        # 30 min max
        "auto_cache_schema":        True,        # cache schema after materialize/preview
        "chunk_size":               500000,      # rows per output parquet file
    },
    "local_tables": {
        "storage_dir":              "data/local_tables",
        "max_size_mb":              10240,       # 10 GB total for all local tables
        "max_tables":               100,
        "auto_discard_days":        10,          # discard public tables unused for N days
        "max_upload_size_mb":       1024,        # 1 GB max upload
        "cleanup_interval_hours":   6,           # run cleanup every N hours
    },
    "queue": {
        "backend":        "sqlite",        # "sqlite" (default) | "redis"
        "redis_url":      "redis://localhost:6379/0",
        "redis_password": "",
        "redis_db":       0,
        "redis_ssl":      False,
        "key_prefix":     "qs",            # namespace prefix for Redis keys
        "task_ttl_hours":  24,             # auto-expire completed tasks in Redis
    },
    "executor": {
        "mode":                        "embedded",  # "embedded" (in-process) | "external" (separate worker)
        "worker_port":                 8002,
        "worker_host":                 "127.0.0.1",
        "poll_interval":               1.0,         # seconds between claim polls (executor side)
        "notification_poll_interval":  1.0,         # seconds between completion polls (FastAPI side)
        "max_concurrent":              10,          # max simultaneous tasks in executor
        "stale_timeout_seconds":       600,         # re-claim stuck tasks after N seconds
        "cleanup_interval_hours":      1,           # cleanup old completed tasks every N hours
        "task_retention_hours":        24,          # keep completed/failed tasks for N hours
        "max_memory_per_task_gb":      4,           # DuckDB memory limit per task (GB, 0=unlimited)
    },
    "anomaly_detection": {
        "enabled": True,
        "z_score_threshold": 2.5,
        "min_history_runs": 5,
        "window_size": 20,
    },
    "features": {
        "streaming_mode":              "all",   # "all" | "stream_only" | "download_only"
        "streaming_enabled_roles":     "admin,analyst,viewer",
        "export_enabled_roles":        "admin,analyst,viewer",
        "sql_editor_enabled_roles":    "admin,analyst",
        "scheduler_enabled_roles":     "admin,analyst",
        "connections_enabled_roles":   "admin,analyst",
        "upload_enabled_roles":        "admin,analyst",
        "max_query_limit_by_role":     "",      # "viewer:1000,analyst:10000" (0=unlimited)
    },
    "circuit_breaker": {
        "enabled":           True,
        "failure_threshold": 3,        # consecutive failures before opening circuit
        "cooldown_seconds":  60,       # seconds before attempting a probe request
    },
    "connection_pool": {
        "enabled":              True,
        "max_size":             5,        # max connectors per connection
        "idle_timeout_seconds": 300,      # close idle connectors after 5 min
    },
    "lineage": {
        "auto_extract":                True,   # extract table refs on query save/execute
        "fallback_regex":              True,   # use regex extractor when sqlglot fails
        "max_reparse_batch":           500,    # max queries to re-parse in one /reparse call
        # Phase 52 — snapshots & freshness
        "snapshots_enabled":           True,   # capture lineage snapshot on each execution
        "freshness_enabled":           True,   # track data freshness per table
        "snapshot_retention_days":     30,     # auto-delete snapshots older than N days
        "default_stale_threshold_hours": 24,   # hours before a table is considered stale
    },
    "semantic_layer": {
        "enabled":                     True,    # enable/disable semantic layer features
        "auto_detect_column_types":    True,    # auto-classify columns as dimension/measure on create
        "max_columns_per_dataset":     500,     # cap to prevent oversized datasets
        "max_datasets":                100,     # total number of datasets allowed
        "cascading_prompts_enabled":   True,    # enable cascading filter LOVs in report builder
        "drill_hierarchies_enabled":   True,    # enable drill-down in business reports
        "aggregation_awareness_enabled": True,  # enable smart routing to pre-agg tables
        "default_row_limit":           10000,   # default max rows for business report execution
        "synonym_matching_enabled":    True,    # match NL queries against column synonyms
        "max_metrics_per_dataset":     50,      # Phase 101: max calculated metrics per dataset
        "metric_validation_enabled":   True,    # Phase 101: validate metric expression on create
    },
    "federation": {
        "enabled":                     True,    # enable/disable federation execution
        "max_concurrent_executions":   5,       # max parallel federation queries
        "execution_timeout_seconds":   600,     # 10 min timeout per execution
        "max_result_rows":             100000,  # hard cap on result rows
        "named_secrets_enabled":       True,    # use DuckDB CREATE SECRET for multi-S3
        "fallback_to_pragmas":         True,    # fallback to SET pragmas if secrets fail
        "execution_history_retention_days": 30, # auto-prune old execution records
        "merge_max_datasets":          5,       # max datasets in a single merged query
        "preview_row_limit":           100,     # rows for quick preview
        "distinct_values_limit":       500,     # max LOV values for cascading prompts
        "http_timeout_ms":             15000,   # DuckDB http_timeout for REST federation (Phase 102-H)
    },
    "agg_cache": {
        "enabled":                          True,     # master toggle for aggregation cache
        "storage_dir":                      "data/agg_cache",  # directory for rollup parquets
        "max_storage_mb":                   5120,     # 5 GB total storage quota
        "max_entries_per_dataset":          20,       # max rollup definitions per dataset
        "default_ttl_hours":                24,       # soft expiry → stale
        "hard_expiry_hours":                72,       # hard expiry → cannot serve, must rebuild
        "stale_serve_enabled":              True,     # serve stale data while triggering background refresh
        "write_through_enabled":            False,    # auto-populate cache on live query miss
        "refresh_timeout_seconds":          1800,     # 30 min max build time
        "cleanup_interval_hours":           6,        # periodic cleanup of expired entries
        "suggestion_enabled":               True,     # auto-suggest cache rules from usage patterns
        "suggestion_min_queries":           5,        # min query occurrences before suggesting
        "suggestion_analysis_window_days":  7,        # analyze last N days of execution history
        "incremental_default":              False,    # default incremental_enabled on new entries
    },
    "business_reports": {
        "enabled":                      True,     # master toggle for business report builder
        "max_reports_per_user":         50,       # max saved reports per user
        "max_sections_per_report":      10,       # max break/section definitions
        "max_parameters_per_report":    20,       # max cascading prompt parameters
        "max_running_calcs_per_report": 15,       # max running calculation columns
        "default_row_limit":            500000,   # default row cap on report execution (500K)
        "pdf_row_limit":                50000,    # max rows in PDF export (50K)
        "excel_row_limit":              1000000,  # max rows in Excel export (1M — xlsxwriter limit)
        "embed_row_limit":              100000,   # max rows in embedded report (100K)
        "cascade_lov_limit":            500,      # max LOV values for parameter dropdowns
        "page_size":                    200,      # default rows per page (server-side pagination)
        "max_page_size":                10000,    # hard cap on page_size query param
        "auto_save_interval_seconds":   30,       # wizard auto-save interval
        "export_formats":               ["csv", "json"],  # allowed export formats
        "async_execution_ttl_seconds":  3600,     # in-memory async execution TTL (1 hour)
        "pdf_page_size":                "A4 landscape",   # WeasyPrint @page size
        "pdf_primary_color":            "#1976d2",        # PDF header background color
        "enable_published_view_source": True,             # Phase 100: allow PV as data source
    },
    "pivot_reports": {
        "enabled":              True,      # master toggle for pivot report builder
        "max_row_dimensions":   3,         # max dimension columns in row headers
        "max_col_dimensions":   2,         # max dimension columns in column headers
        "max_measures":         5,         # max measure/value fields
        "max_row_groups":       500,       # max distinct row groups in result
        "max_col_groups":       50,        # max distinct column groups (pivot columns)
        "default_aggregation":  "sum",     # default agg when dragging measure to Values
    },
    "aws_portal": {
        "enabled":              False,       # enable AWS portal credential provider
        "portal_base_url":      "",          # base URL (e.g. https://awsportal.company.com) — derives jwt/roles/creds endpoints
        "jwt_url":              "",          # override: POST endpoint for JWT token (default: {portal_base_url}/v1/jwttoken)
        "creds_url_template":   "",          # legacy: direct credential GET URL template (skips role lookup)
        "account_id":           "",          # AWS account ID — used to match the correct role ARN
        "role_name":            "",          # IAM role search term (e.g. "app-NormalAppRole")
        "sf_ref_no":            "",          # service first number — passed to credential endpoint
        "service_username":     "",          # system/service account username (shared connections)
        "service_password":     "",          # system/service account password (shared connections)
        "proxy_url":            "",          # corporate proxy URL (e.g. http://user:pass@proxy:8080) — used if proxy_host is empty
        "proxy_host":           "",          # corporate proxy hostname (e.g. proxy.corp.com) — auto-builds proxy URL
        "proxy_port":           8080,        # corporate proxy port
        "proxy_username":       "",          # proxy authentication username
        "proxy_password":       "",          # proxy authentication password
        "verify_ssl":           False,       # verify SSL certs for portal requests (False for on-prem)
        "creds_ttl_seconds":    3300,        # cache TTL (55 min, STS default is 1hr)
        "timeout_seconds":      30,          # HTTP request timeout
        "auto_retry_on_expiry": True,        # auto-refresh portal creds on TokenExpiredError
        "max_retry_attempts":   1,           # max retries per request on token expiry
        "system_account_fallback": True,     # fall back to config.json service account if DB account fails
    },
    "chatbot": {
        # Column classification patterns for the AI Assistant chip suggestions.
        # Patterns are matched case-insensitively as substrings of column names.
        # Add your organisation's column names or partial patterns to extend detection.
        "numeric_patterns": [
            "amount", "balance", "debit", "credit", "payment", "charge",
            "revenue", "income", "expense", "cost", "price", "fee", "tax",
            "profit", "margin", "discount", "interest", "principal", "penalty",
            "salary", "wage", "bonus", "commission",
            "total", "subtotal", "value", "rate", "ratio", "percentage", "percent",
            "qty", "quantity", "count", "number", "num", "volume", "weight", "size",
            "score", "rank", "metric", "measure", "kpi",
        ],
        "category_patterns": [
            "status", "state", "flag", "indicator", "active", "enabled",
            "type", "category", "class", "kind", "level", "tier", "grade", "segment",
            "dept", "department", "division", "team", "group", "unit", "branch",
            "entity", "company", "organisation", "organization", "business",
            "country", "region", "city", "zone", "area", "location", "site",
            "currency", "ccy", "source", "channel", "product",
            "brand", "vendor", "supplier", "customer", "client",
        ],
        "date_patterns": [
            "date", "dt", "time", "ts", "timestamp",
            "period", "month", "year", "day", "week", "quarter",
            "fiscal", "posted", "effective", "settlement", "maturity", "created",
            "updated", "modified", "processed", "received", "booked",
        ],
        "id_patterns": [
            "_id", "_key", "_ref", "_uuid", "_guid", "_code", "_num", "_no",
            "_hash", "_token", "_seq", "id_", "key_", "ref_", "uuid_",
        ],
        # Phase 57 — Enhanced NL Chatbot
        "semantic_context_enabled":    True,    # use semantic layer / schema_cache for NL enrichment
        "time_intelligence_enabled":   True,    # enable YTD/MTD/SPLY/PoP/moving-avg patterns
        "max_pattern_alternatives":    3,       # max alternative SQL variants returned
    },
    "suggestion_corrections": {
        "enabled":                  True,    # master toggle for suggestion learning
        "max_corrections":          1000,    # cap total stored corrections
        "agg_pattern_priority":     True,    # pattern rules first, corrections override
        "join_correction_priority": True,    # prefer learned join keys over heuristic
        "retention_days":           365,     # auto-prune corrections older than N days
        "chart_feedback_enabled":   True,    # enable chart preset like/dislike feedback
        "pivot_feedback_enabled":   True,    # enable pivot preset like/dislike feedback
        "nl_feedback_lookup_enabled":       True,   # wire NL→SQL feedback into generation
        "nl_feedback_min_similarity":       0.8,    # min Jaccard token overlap for match
        "nl_feedback_auto_return_threshold": 0.9,   # similarity above which to auto-return cached SQL
    },
    # Phase 60 — Delivery & Alerts
    "delivery": {
        "enabled":                          True,
        "max_subscriptions_per_user":       50,
        "max_recipients_per_subscription":  20,
        "retry_max_attempts":               3,
        "retry_backoff_minutes":            5,
        "delivery_history_retention_days":  90,
        "max_pdf_rows":                     10000,
        "unsubscribe_token_expiry_days":    365,
        "batch_size":                       20,
        "check_interval_minutes":           5,
    },
    "rest_api": {
        "enabled":                    True,
        "max_response_size_mb":       50,
        "max_rows_per_query":         100000,
        "default_timeout_seconds":    30,
        "max_timeout_seconds":        300,
        "oauth2_token_cache_seconds": 3500,
        "flatten_max_depth":          5,
    },
    "horizontal_workers": {
        "registry_backend":            "auto",   # "auto" | "redis" | "sqlite"
        "heartbeat_interval_seconds":  15,
        "heartbeat_ttl_seconds":       45,        # 3x interval — miss 3 heartbeats → dead
        "worker_eviction_seconds":     120,       # remove from registry after this
        "max_workers_per_host":        10,
        "enable_load_aware_claiming":  True,
        "memory_threshold_pct":        85,        # skip claiming if memory usage > this
        "cpu_threshold_pct":           90,        # skip claiming if CPU > this
        "metrics_retention_hours":     24,
    },
    "streaming": {
        "cancel_enabled":              True,
        "max_active_streams":          50,        # max concurrent streaming queries
        "cancel_check_interval_rows":  5000,      # check cancel every N rows processed
    },
    "presigned_url": {
        "expiry_seconds":              900,       # 15 min default
        "retry_enabled":               True,
        "max_retries":                 2,
        "retry_on_403":                True,      # re-generate URL on 403 (expired signature)
        "retry_delay_seconds":         1,
        "download_timeout_seconds":    120,       # Phase 78G — configurable download timeout
    },
    # Phase 79 — DuckDB Resilience
    "duckdb": {
        "circuit_breaker_enabled":      True,   # trip breaker after N engine crashes
        "retry_on_engine_error":        True,   # retry once on subprocess crash (not timeout/bad SQL)
        "retry_max_attempts":           1,      # max retries (0 = no retry)
        "retry_delay_seconds":          1,      # seconds to wait before retry
    },
    # Phase 78 — S3 Production Hardening
    "s3_validation": {
        "bucket_name_regex_aws":                   r"^[a-z0-9]([a-z0-9\-]{1,61}[a-z0-9])?$",
        "bucket_name_regex_onprem":                r"^[a-zA-Z0-9][a-zA-Z0-9\-_\.]{0,253}[a-zA-Z0-9]$",
        "validate_bucket_on_create":               True,
        "validate_arn_format":                     True,
        "arn_regex":                               r"^arn:(aws|aws-cn|aws-us-gov):iam::\d{12}:role\/[\w+=,.@\-\/]{1,256}$",
        "root_prefix_test_on_create":              True,
        "warn_unsupported_partition_ops":          True,
        "max_folder_browser_items":                500,
        "partition_refresh_mutex_timeout_seconds": 30,
        "file_list_max_files":                     5000,
    },
    # Phase 76 — Feed File Generation
    "feed_generation": {
        "enabled":                     True,
        "max_concurrent_native":       3,
        "output_dir":                  "data/feeds",
        "max_output_rows":             1000000,
        "max_file_size_mb":            500,
        "default_output_format":       "csv",
        "filename_template":           "{name}_{date}.{ext}",
        "auto_route_threshold_rows":   500000,
        "retry_max_attempts":          2,
        "retry_delay_seconds":         60,
        "execution_history_retention_days": 90,
        "cleanup_interval_hours":      6,
        "chunk_size":                  100000,
        "airflow": {
            "enabled":                 False,
            "base_url":                "http://airflow:8080",
            "auth_type":               "basic",
            "username":                "",
            "password":                "",
            "default_dag_id":          "querystudio_feed",
            "output_s3_bucket":        "",
            "output_s3_prefix":        "feed-output/",
            "poll_interval_seconds":   10,
            "poll_timeout_seconds":    3600,
            "use_callback_webhook":    False,
        },
        "spark_livy": {
            "enabled":                 False,
            "base_url":                "http://livy:8998",
            "auth_type":               "none",
            "username":                "",
            "password":                "",
            "default_script_path":     "",
            "driver_memory":           "2g",
            "executor_memory":         "4g",
            "num_executors":           4,
            "spark_conf":              {},
            "poll_interval_seconds":   15,
            "poll_timeout_seconds":    7200,
        },
        "sftp": {
            "connect_timeout_seconds": 30,
            "upload_timeout_seconds":  300,
        },
    },
    # Phase 77 — Smart Predictions (charts, pivots, data profiling)
    "smart_predictions": {
        "enabled":                  True,
        "max_chart_suggestions":    5,
        "max_pivot_suggestions":    4,
        "profile_max_top_values":   10,
        "outlier_method":           "iqr",       # "iqr" | "zscore"
        "outlier_iqr_multiplier":   1.5,
        "profile_sample_limit":     100000,
        "inline_chart_enabled":     True,
    },
    # Phase 95 — Local Transformer Semantic Intelligence
    "local_llm": {
        "enabled":                      False,      # master toggle — opt-in only
        "model_path":                   "cssupport/t5-small-awesome-text-to-sql",  # HuggingFace model ID or local path
        "model_name":                   "",          # display name for admin UI
        "n_ctx":                        512,         # max input token length (512 for T5-small)
        "n_gpu_layers":                 0,           # 0 = CPU only, -1 = auto GPU
        "max_tokens":                   256,         # max generation tokens
        "temperature":                  0.1,         # low = deterministic SQL
        "embedder_model":               "all-MiniLM-L6-v2",  # sentence-transformers model name
        "embedder_enabled":             True,        # enable semantic similarity (sentence-transformers)
        "sql_generation_enabled":       True,        # enable SQL generation (HuggingFace transformers)
        "startup_preload":              True,        # pre-load models at startup
        "generation_timeout_seconds":   30,          # timeout per generation call
        "finance_domain_hints":         True,        # include SAP/finance context in prompts
    },
    # Phase 99 — Data Quality Monitoring
    "data_quality": {
        "enabled":                      True,       # master toggle
        "schedule_interval_minutes":    60,         # default APScheduler interval for DQ checks
        "execution_timeout_seconds":    300,        # timeout per rule execution
        "result_retention_days":        90,         # auto-cleanup old results
        "max_rules":                    200,        # max DQ rules total
        "max_concurrent_checks":        5,          # max parallel rule executions
        "notify_on_failure":            True,       # send WS notification on rule failure
        "notify_severity_threshold":    "warning",  # "info" | "warning" | "critical"
        "cleanup_interval_hours":       6,          # cleanup daemon interval
        "alert_channels":               [],         # [{"type":"email","smtp_host":...}, {"type":"webhook","url":...}, {"type":"slack","webhook_url":...}]
    },
    # Phase 100 — Onboarding / Guided Tours
    "onboarding": {
        "enabled":                      True,       # master toggle
        "auto_show_on_first_login":     True,       # auto-start tour for new users
        "available_tours":              ["getting_started", "query_builder",
                                         "business_reports", "data_quality",
                                         "published_views"],
        "default_tour":                 "getting_started",
    },
    # Phase 114 — Report Collaboration
    "collaboration": {
        "enabled":                      True,
        "max_comments_per_report":     500,
        "change_log_retention_days":   365,
        "mentions_enabled":            True,
    },
    # Phase 75 — Published Views API (external data access)
    "published_views": {
        "enabled":                     True,
        "max_concurrent":              5,          # dedicated concurrency pool (separate from main queries)
        "default_cache_ttl_seconds":   300,        # 5 min default response cache per view+filter combo
        "max_cache_size_mb":           2048,       # 2 GB max for published view response cache
        "cache_dir":                   "data/published_cache",
        "default_rate_limit":          "60/minute",   # per-API-key rate limit
        "max_rate_limit":              "300/minute",  # hard cap on per-key limit
        "default_row_limit":           100000,     # default rows returned to API consumers (100K)
        "max_row_limit":               1000000,    # hard cap on rows per request (1M)
        "api_key_prefix":              "qs_",      # prefix for generated API keys
        "access_log_retention_days":   90,
        "cleanup_interval_hours":      6,
        "param_substitution_enabled":  True,   # Phase 80: enable {{param}} substitution in query configs
        "dedup_timeout_seconds":       60,     # Phase 80: max seconds to wait for an in-flight duplicate request
        "ad_group_fetch_fail_mode":    "deny", # Phase 83H: "deny"|"allow" — what to do when AD group fetch fails
        # Phase 98-I: Kafka-driven cache invalidation (disabled by default)
        "kafka_enabled":               False,
        "kafka_bootstrap_servers":     "localhost:9092",
        "kafka_topic_pattern":         "{table}_{partition_col}",
        "kafka_consumer_group":        "querystudio_cache_invalidation",
        "kafka_auto_offset_reset":     "latest",
        "kafka_session_timeout_ms":    30000,
    },
}


def _load_file() -> dict:
    # Allow tests / container deployments to override the config file path
    env_override = os.environ.get("QUERYSTUDIO_CONFIG")
    file_to_load = Path(env_override) if env_override else _CONFIG_FILE
    if file_to_load.exists():
        try:
            with open(file_to_load, "r", encoding="utf-8") as f:
                data = json.load(f)
            logger.info("Loaded config from %s", file_to_load)
            return data
        except Exception as e:
            logger.warning("Failed to parse %s: %s — using defaults", file_to_load, e)
    return {}


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base (override wins)."""
    result = dict(base)
    for k, v in override.items():
        if k.startswith("_comment"):
            continue
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def _apply_env(cfg: dict, prefix: str = "QUERYSTUDIO") -> dict:
    """
    Override config values from environment variables.

    Mapping:  QUERYSTUDIO_SERVER_PORT=9000  →  cfg["server"]["port"] = 9000
              QUERYSTUDIO_PATHS_DATA_DIR=/mnt/data  →  cfg["paths"]["data_dir"] = "/mnt/data"
    """
    for key, raw in os.environ.items():
        if not key.upper().startswith(prefix + "_"):
            continue
        parts = key[len(prefix) + 1:].lower().split("_", 1)
        if len(parts) != 2:
            continue
        section, field = parts
        if section not in cfg:
            continue
        if field not in cfg[section]:
            continue
        original = cfg[section][field]
        try:
            if isinstance(original, bool):
                cfg[section][field] = raw.lower() in ("1", "true", "yes")
            elif isinstance(original, int):
                cfg[section][field] = int(raw)
            elif isinstance(original, float):
                cfg[section][field] = float(raw)
            elif isinstance(original, list):
                cfg[section][field] = [v.strip() for v in raw.split(",")]
            else:
                cfg[section][field] = raw
        except ValueError:
            logger.warning("Could not cast env var %s=%r to %s — skipping", key, raw, type(original).__name__)
    return cfg


# ── Build the merged config once at import time ──────────────────────────────
_file_cfg = _load_file()
_merged   = _deep_merge(_DEFAULTS, _file_cfg)
_cfg      = _apply_env(_merged)


# ── Startup Validation ────────────────────────────────────────────────────────

def validate_config() -> list[str]:
    """Validate critical config values on startup. Returns list of warnings/errors.

    Called by main.py at app init. Logs warnings for non-critical issues,
    raises on fatal misconfigurations.
    """
    issues: list[str] = []

    def _check_type(section: str, key: str, expected: type, label: str = ""):
        val = _cfg.get(section, {}).get(key)
        if val is not None and not isinstance(val, expected):
            try:
                expected(val)  # try coercion
            except (ValueError, TypeError):
                issues.append(f"[{section}.{key}] expected {expected.__name__}, got {type(val).__name__}: {val!r}")

    def _check_range(section: str, key: str, lo: float = 0, hi: float = float('inf'), label: str = ""):
        val = _cfg.get(section, {}).get(key)
        if val is not None:
            try:
                n = float(val)
                if n < lo or n > hi:
                    issues.append(f"[{section}.{key}] value {val} out of range [{lo}, {hi}]")
            except (ValueError, TypeError):
                pass  # type check handles this

    def _check_enum(section: str, key: str, allowed: set, label: str = ""):
        val = _cfg.get(section, {}).get(key)
        if val is not None and val not in allowed:
            issues.append(f"[{section}.{key}] value {val!r} not in {sorted(allowed)}")

    # ── Critical type/enum checks ──
    _check_enum("database", "type", {"sqlite", "postgresql", "oracle"})
    _check_enum("auth", "type", {"none", "ad", "local"})
    _check_enum("server", "log_level", {"debug", "info", "warning", "error", "critical"})
    _check_enum("server", "log_format", {"json", "text"})

    # ── Port/numeric range checks ──
    _check_range("server", "port", 1, 65535)
    _check_range("server", "workers", 1, 32)
    _check_range("query_engine", "chunk_size", 1000, 10_000_000)
    _check_range("query_engine", "query_timeout_seconds", 0, 86400)
    _check_range("limits", "max_download_size_mb", 1, 100_000)
    _check_range("limits", "max_concurrent_queries", 1, 1000)
    _check_range("cache", "max_entries", 1, 100_000)
    _check_range("cache", "ttl_seconds", 0, 604_800)  # max 7 days
    _check_range("database", "postgresql_pool_size", 1, 200)
    _check_range("database", "postgresql_max_overflow", 0, 200)
    _check_range("database", "postgresql_pool_timeout", 1, 300)

    # ── Boolean type checks ──
    for section, key in [
        ("auth", "ad_use_ssl"), ("auth", "ad_tls_validate"),
        ("features", "enable_streaming"), ("features", "enable_cache"),
        ("lineage", "auto_extract"), ("lineage", "snapshots_enabled"),
        ("chatbot", "semantic_context_enabled"),
        ("local_llm", "enabled"),
        ("local_llm", "embedder_enabled"),
        ("local_llm", "sql_generation_enabled"),
        ("local_llm", "startup_preload"),
        ("local_llm", "finance_domain_hints"),
    ]:
        val = _cfg.get(section, {}).get(key)
        if val is not None and not isinstance(val, bool):
            if str(val).lower() not in ("true", "false", "0", "1"):
                issues.append(f"[{section}.{key}] expected boolean, got {type(val).__name__}: {val!r}")

    # ── Warn about unknown top-level sections ──
    known_sections = frozenset(_DEFAULTS.keys())
    for section in _cfg:
        if section not in known_sections:
            issues.append(f"[{section}] unknown config section (typo?)")

    # ── Production safety warnings (non-blocking) ──
    _cors_origins = _cfg.get("cors", {}).get("allow_origins", ["*"])
    _auth_type = _cfg.get("auth", {}).get("type", "none")
    if _cors_origins == ["*"] and _auth_type != "none":
        logger.warning(
            "Config: CORS allow_origins is ['*'] with auth enabled — "
            "restrict to specific domains in production"
        )

    # Multi-pod safety checks
    _replicas = 1
    try:
        _replicas = int(os.environ.get("QUERYSTUDIO_REPLICAS", "1"))
    except (ValueError, TypeError):
        pass
    if _replicas > 1:
        _db_type = _cfg.get("database", {}).get("type", "sqlite")
        _queue_backend = _cfg.get("queue", {}).get("backend", "database")
        if _db_type == "sqlite":
            logger.warning(
                "Config: database.type='sqlite' with %d replicas — "
                "SQLite may cause write contention; consider PostgreSQL",
                _replicas,
            )
        if _queue_backend != "redis":
            logger.warning(
                "Config: queue.backend='%s' with %d replicas — "
                "rate limiting and task dedup are per-pod; consider Redis",
                _queue_backend, _replicas,
            )
        logger.info(
            "Config: %d replicas detected — in-memory caches are "
            "process-local (data may be duplicated across pods)",
            _replicas,
        )

    # Log results
    for issue in issues:
        logger.warning("Config validation: %s", issue)

    if issues:
        logger.warning("Config validation found %d issue(s) — review config.json", len(issues))

    return issues


def get(section: str, key: str, fallback: Any = None) -> Any:
    """Return a config value. Falls back to `fallback` if not found."""
    return _cfg.get(section, {}).get(key, fallback)


def set(section: str, key: str, value: Any) -> None:  # noqa: A001
    """Set a runtime config value (in-process only, not persisted to config.json)."""
    if section not in _cfg:
        _cfg[section] = {}
    _cfg[section][key] = value


# ── Convenience accessors ─────────────────────────────────────────────────────

class _ServerCfg:
    host:       str = property(lambda self: get("server", "host"))        # type: ignore[assignment]
    port:       int = property(lambda self: get("server", "port"))        # type: ignore[assignment]
    log_level:  str = property(lambda self: get("server", "log_level"))   # type: ignore[assignment]
    log_format:    str = property(lambda self: get("server", "log_format", "json"))    # type: ignore[assignment]
    log_file:          str = property(lambda self: str(get("server", "log_file", "")))           # type: ignore[assignment]
    log_retention_days: int = property(lambda self: int(get("server", "log_retention_days", 2)))  # type: ignore[assignment]
    otel_endpoint: str = property(lambda self: get("server", "otel_endpoint", ""))    # type: ignore[assignment]
    workers:       int = property(lambda self: get("server", "workers"))               # type: ignore[assignment]
    ssl_certfile:         str  = property(lambda self: str(get("server", "ssl_certfile", "")))          # type: ignore[assignment]
    ssl_keyfile:          str  = property(lambda self: str(get("server", "ssl_keyfile", "")))           # type: ignore[assignment]
    ssl_keyfile_password: str  = property(lambda self: str(get("server", "ssl_keyfile_password", "")))  # type: ignore[assignment]
    https_redirect:       bool = property(lambda self: bool(get("server", "https_redirect", False)))    # type: ignore[assignment]

_HERE = Path(__file__).resolve().parent.parent  # backend/


def _resolve(rel: str) -> Path:
    """Resolve a path that may be relative (to backend/) or absolute."""
    p = Path(rel)
    return p if p.is_absolute() else (_HERE / p)


class _PathsCfg:
    @property
    def data_dir(self)        -> Path: return _resolve(get("paths", "data_dir"))
    @property
    def parquet_dir(self)     -> Path: return _resolve(get("paths", "parquet_dir"))
    @property
    def downloads_dir(self)   -> Path: return _resolve(get("paths", "downloads_dir"))
    @property
    def db_file(self)         -> Path: return _resolve(get("paths", "db_file"))
    @property
    def secret_key_file(self) -> Path: return _resolve(get("paths", "secret_key_file"))
    @property
    def upload_dir(self)      -> Path: return _resolve(get("paths", "upload_dir"))
    @property
    def duckdb_temp_dir(self) -> Path: return _resolve(get("paths", "duckdb_temp_dir"))
    @property
    def download_temp_dir(self) -> Path: return _resolve(get("paths", "download_temp_dir"))
    @property
    def db_url(self)          -> str:
        return "sqlite:///" + self.db_file.as_posix()


class _QueryEngineCfg:
    @property
    def chunk_size(self)  -> int: return int(get("query_engine", "chunk_size"))
    @property
    def max_workers(self) -> int:
        w = int(get("query_engine", "max_workers"))
        return w if w > 0 else min(32, (os.cpu_count() or 4) + 4)
    @property
    def query_timeout_seconds(self) -> int:
        return int(get("query_engine", "query_timeout_seconds", 1800))
    @property
    def max_concurrent_per_user(self) -> int:
        return int(get("query_engine", "max_concurrent_per_user", 10))
    @property
    def max_concurrent_global(self) -> int:
        return int(get("query_engine", "max_concurrent_global", 50))
    @property
    def max_queue_size(self) -> int:
        return int(get("query_engine", "max_queue_size", 100))
    @property
    def duckdb_threads_per_query(self) -> int:
        """Max DuckDB threads per connection. 0 = auto (cpu_count / 4, min 2)."""
        v = int(get("query_engine", "duckdb_threads_per_query", 4))
        if v > 0:
            return v
        # Auto: quarter of CPU cores, min 2
        cpus = os.cpu_count() or 4
        return max(2, cpus // 4)
    @property
    def duckdb_memory_limit_mb(self) -> int:
        """Per-connection DuckDB memory limit in MB. 0 = unlimited. Default 2GB."""
        return int(get("query_engine", "duckdb_memory_limit_mb", 2048))


class _S3Cfg:
    @property
    def default_region(self) -> str: return get("s3", "default_region")
    @property
    def handler_cache_ttl_seconds(self) -> int: return int(get("s3", "handler_cache_ttl_seconds", 2700))
    @property
    def default_onprem_access_mode(self) -> str: return str(get("s3", "default_onprem_access_mode", "presigned"))
    @property
    def parallel_download_workers(self) -> int: return int(get("s3", "parallel_download_workers", 8))


class _S3ResultsCfg:
    @property
    def enabled(self) -> bool: return bool(get("s3_results", "enabled", False))
    @property
    def storage_mode(self) -> str: return str(get("s3_results", "storage_mode", "local"))  # "local" | "s3" | "auto"
    @property
    def size_threshold_mb(self) -> int: return int(get("s3_results", "size_threshold_mb", 10))
    @property
    def size_threshold_bytes(self) -> int: return self.size_threshold_mb * 1024 * 1024
    @property
    def prefix(self) -> str: return str(get("s3_results", "prefix", "querystudio/results/"))
    @property
    def delete_local_after_upload(self) -> bool: return bool(get("s3_results", "delete_local_after_upload", False))
    @property
    def bucket_override(self) -> str: return str(get("s3_results", "bucket_override", ""))


class _StorageCfg:
    @property
    def max_cache_size_mb(self)     -> int: return int(get("storage", "max_cache_size_mb", 2048))
    @property
    def max_downloads_size_mb(self) -> int: return int(get("storage", "max_downloads_size_mb", 10240))
    @property
    def downloads_expiry_days(self) -> int: return int(get("storage", "downloads_expiry_days", 7))


class _SchedulerCfg:
    @property
    def cleanup_temp_files_hours(self)   -> int: return int(get("scheduler", "cleanup_temp_files_hours"))
    @property
    def max_missed_jobs(self)            -> int: return int(get("scheduler", "max_missed_jobs"))
    @property
    def execution_retention_days(self)   -> int: return int(get("scheduler", "execution_retention_days", 30))
    @property
    def mode(self)                       -> str:   return get("scheduler", "mode", "embedded")
    @property
    def worker_port(self)                -> int:   return int(get("scheduler", "worker_port", 8001))
    @property
    def worker_host(self)                -> str:   return get("scheduler", "worker_host", "127.0.0.1")
    @property
    def notification_poll_interval(self) -> float: return float(get("scheduler", "notification_poll_interval", 1.5))
    @property
    def job_pool_size(self)              -> int:   return int(get("scheduler", "job_pool_size", 20))
    @property
    def worker_url(self)                 -> str:   return f"http://{self.worker_host}:{self.worker_port}"


class _CorsCfg:
    @property
    def allow_origins(self) -> list: return get("cors", "allow_origins")
    @property
    def allow_methods(self) -> list: return get("cors", "allow_methods")
    @property
    def allow_headers(self) -> list: return get("cors", "allow_headers")


class _DatabaseCfg:
    @property
    def type(self) -> str:
        return get("database", "type", "sqlite").lower()

    @property
    def postgresql_url(self) -> str:
        return get("database", "postgresql_url", "")

    @property
    def postgresql_pool_size(self) -> int:
        return int(get("database", "postgresql_pool_size", 20))

    @property
    def postgresql_max_overflow(self) -> int:
        return int(get("database", "postgresql_max_overflow", 30))

    @property
    def postgresql_pool_timeout(self) -> int:
        return int(get("database", "postgresql_pool_timeout", 30))

    @property
    def postgresql_ssl_mode(self) -> str:
        return get("database", "postgresql_ssl_mode", "prefer")

    # ── Read replica properties (Phase 43) ──
    @property
    def replica_urls(self) -> list:
        val = get("database", "replica_urls", [])
        if isinstance(val, str):
            return [u.strip() for u in val.split(",") if u.strip()] if val else []
        return list(val) if val else []

    @property
    def read_preference(self) -> str:
        return get("database", "read_preference", "replica")

    @property
    def replica_pool_size(self) -> int:
        return int(get("database", "replica_pool_size", 10))

    @property
    def replica_max_overflow(self) -> int:
        return int(get("database", "replica_max_overflow", 15))

    @property
    def replica_pool_timeout(self) -> int:
        return int(get("database", "replica_pool_timeout", 20))

    @property
    def replica_health_interval_seconds(self) -> int:
        return int(get("database", "replica_health_interval_seconds", 30))

    @property
    def replica_max_lag_seconds(self) -> int:
        return int(get("database", "replica_max_lag_seconds", 5))

    @property
    def db_url(self) -> str:
        """Return the SQLAlchemy DB URL for the metadata store."""
        if self.type == "postgresql" and self.postgresql_url:
            return self.postgresql_url
        if self.type == "oracle":
            user = get("database", "oracle_user") or os.getenv("QUERYSTUDIO_DATABASE_ORACLE_USER", "")
            pwd  = get("database", "oracle_password") or os.getenv("QUERYSTUDIO_DATABASE_ORACLE_PASSWORD", "")
            dsn  = get("database", "oracle_dsn") or os.getenv("QUERYSTUDIO_DATABASE_ORACLE_DSN", "")
            if not (user and pwd and dsn):
                raise ValueError(
                    "database.type=oracle requires oracle_user, oracle_password, and oracle_dsn "
                    "in config.json or QUERYSTUDIO_DATABASE_ORACLE_* env vars."
                )
            return f"oracle+oracledb://{user}:{pwd}@{dsn}"
        # Default: SQLite
        return "sqlite:///" + _PathsCfg().db_file.as_posix()


class _AuthCfg:
    @property
    def type(self) -> str:
        return get("auth", "type", "none").lower()

    # ── Local auth ──
    @property
    def local_users(self) -> dict:
        """Parse 'user1:pass1,user2:pass2' into {user1: pass1, ...}"""
        raw = get("auth", "local_users", "")
        if not raw:
            return {}
        result = {}
        for pair in raw.split(","):
            pair = pair.strip()
            if ":" in pair:
                u, p = pair.split(":", 1)
                result[u.strip()] = p.strip()
        return result

    @property
    def user_roles(self) -> dict:
        """Parse 'user1:admin,user2:analyst' into {user1: admin, ...}"""
        raw = get("auth", "user_roles", "")
        if not raw:
            return {}
        result = {}
        for pair in raw.split(","):
            pair = pair.strip()
            if ":" in pair:
                u, r = pair.split(":", 1)
                result[u.strip().lower()] = r.strip().lower()
        return result

    # ── AD config ──
    @property
    def ad_server(self) -> str:         return get("auth", "ad_server", "")
    @property
    def ad_domain(self) -> str:         return get("auth", "ad_domain", "")
    @property
    def ad_base_dn(self) -> str:        return get("auth", "ad_base_dn", "")
    @property
    def ad_user_search_filter(self) -> str:
        return get("auth", "ad_user_search_filter", "(sAMAccountName={username})")
    @property
    def ad_group_attribute(self) -> str: return get("auth", "ad_group_attribute", "memberOf")
    @property
    def ad_admin_groups(self) -> list:
        raw = get("auth", "ad_admin_groups", "")
        return [g.strip().lower() for g in raw.split(",") if g.strip()] if raw else []
    @property
    def ad_analyst_groups(self) -> list:
        raw = get("auth", "ad_analyst_groups", "")
        return [g.strip().lower() for g in raw.split(",") if g.strip()] if raw else []
    @property
    def ad_viewer_groups(self) -> list:
        raw = get("auth", "ad_viewer_groups", "")
        return [g.strip().lower() for g in raw.split(",") if g.strip()] if raw else []
    @property
    def ad_service_account(self) -> str: return get("auth", "ad_service_account", "")
    @property
    def ad_service_password(self) -> str: return get("auth", "ad_service_password", "")
    @property
    def ad_connect_timeout(self) -> int: return int(get("auth", "ad_connect_timeout", 3))
    @property
    def ad_receive_timeout(self) -> int: return int(get("auth", "ad_receive_timeout", 10))
    @property
    def ad_use_ssl(self) -> bool: return bool(get("auth", "ad_use_ssl", False))
    @property
    def ad_tls_validate(self) -> bool: return bool(get("auth", "ad_tls_validate", True))
    @property
    def ad_tls_check_hostname(self) -> bool: return bool(get("auth", "ad_tls_check_hostname", False))
    @property
    def ad_tls_ca_file(self) -> str: return str(get("auth", "ad_tls_ca_file", "") or "")


class _EmailCfg:
    @property
    def host(self) -> str:         return get("email", "host", "")
    @property
    def port(self) -> int:         return int(get("email", "port", 587))
    @property
    def user(self) -> str:         return get("email", "user", "")
    @property
    def password(self) -> str:     return get("email", "password", "")
    @property
    def from_address(self) -> str: return get("email", "from_address", "")
    @property
    def use_tls(self) -> bool:     return bool(get("email", "use_tls", True))
    @property
    def enabled(self) -> bool:     return bool(self.host)


class _CacheCfg:
    @property
    def enabled(self)     -> bool: return bool(get("cache", "enabled", True))
    @property
    def ttl_seconds(self) -> int:  return int(get("cache", "ttl_seconds", 3600))
    @property
    def max_size_mb(self) -> int:  return int(get("cache", "max_size_mb", 2048))
    @property
    def download_ttl_seconds(self) -> int:
        return int(get("cache", "download_ttl_seconds", 7 * 24 * 3600))
    # Phase 104 — partition-aware cache invalidation
    @property
    def partition_aware_invalidation(self) -> bool:
        return bool(get("cache", "partition_aware_invalidation", True))
    @property
    def snapshot_check_ttl_seconds(self) -> int:
        return int(get("cache", "snapshot_check_ttl_seconds", 300))
    @property
    def snapshot_sweep_interval_hours(self) -> int:
        return int(get("cache", "snapshot_sweep_interval_hours", 2))
    @property
    def parquet_file_list_check(self) -> bool:
        return bool(get("cache", "parquet_file_list_check", True))


class _WorkerPoolCfg:
    @property
    def total_workers(self) -> int:
        return int(get("worker_pool", "total_workers", 40))
    @property
    def drain_timeout_seconds(self) -> int:
        return int(get("worker_pool", "drain_timeout_seconds", 15))

    # Per-type settings (interactive, report, scheduled, export, system)
    def _type_int(self, prefix: str, suffix: str, default: int) -> int:
        return int(get("worker_pool", f"{prefix}_{suffix}", default))

    @property
    def interactive_max_concurrent(self) -> int: return self._type_int("interactive", "max_concurrent", 30)
    @property
    def interactive_default_timeout(self) -> int: return self._type_int("interactive", "default_timeout", 1800)
    @property
    def interactive_max_queue(self) -> int: return self._type_int("interactive", "max_queue", 100)

    @property
    def report_max_concurrent(self) -> int: return self._type_int("report", "max_concurrent", 10)
    @property
    def report_default_timeout(self) -> int: return self._type_int("report", "default_timeout", 3600)
    @property
    def report_max_queue(self) -> int: return self._type_int("report", "max_queue", 20)

    @property
    def scheduled_max_concurrent(self) -> int: return self._type_int("scheduled", "max_concurrent", 5)
    @property
    def scheduled_default_timeout(self) -> int: return self._type_int("scheduled", "default_timeout", 7200)
    @property
    def scheduled_max_queue(self) -> int: return self._type_int("scheduled", "max_queue", 50)

    @property
    def export_max_concurrent(self) -> int: return self._type_int("export", "max_concurrent", 8)
    @property
    def export_default_timeout(self) -> int: return self._type_int("export", "default_timeout", 900)
    @property
    def export_max_queue(self) -> int: return self._type_int("export", "max_queue", 30)

    @property
    def system_max_concurrent(self) -> int: return self._type_int("system", "max_concurrent", 10)
    @property
    def system_default_timeout(self) -> int: return self._type_int("system", "default_timeout", 300)
    @property
    def system_max_queue(self) -> int: return self._type_int("system", "max_queue", 50)

    # Phase 98-A: Published Views API worker pool
    @property
    def published_api_max_concurrent(self) -> int: return self._type_int("published_api", "max_concurrent", 50)
    @property
    def published_api_default_timeout(self) -> int: return self._type_int("published_api", "default_timeout", 1800)
    @property
    def published_api_max_queue(self) -> int: return self._type_int("published_api", "max_queue", 200)

    def build_type_configs(self) -> dict:
        """Build a WorkType → TypeConfig dict for WorkerPool init."""
        from core.worker_pool import WorkType, TypeConfig
        return {
            WorkType.INTERACTIVE:   TypeConfig(self.interactive_max_concurrent,   self.interactive_default_timeout,   self.interactive_max_queue),
            WorkType.REPORT:        TypeConfig(self.report_max_concurrent,        self.report_default_timeout,        self.report_max_queue),
            WorkType.SCHEDULED:     TypeConfig(self.scheduled_max_concurrent,     self.scheduled_default_timeout,     self.scheduled_max_queue),
            WorkType.EXPORT:        TypeConfig(self.export_max_concurrent,        self.export_default_timeout,        self.export_max_queue),
            WorkType.SYSTEM:        TypeConfig(self.system_max_concurrent,        self.system_default_timeout,        self.system_max_queue),
            WorkType.PUBLISHED_API: TypeConfig(self.published_api_max_concurrent, self.published_api_default_timeout, self.published_api_max_queue),
        }


class _LimitsCfg:
    @property
    def max_stream_files(self) -> int:
        return int(get("limits", "max_stream_files", 200))
    @property
    def stream_query_limit_default(self) -> int:
        return int(get("limits", "stream_query_limit_default", 500))
    @property
    def stream_query_limit_max(self) -> int:
        return int(get("limits", "stream_query_limit_max", 5000))
    @property
    def stream_page_size_default(self) -> int:
        return int(get("limits", "stream_page_size_default", 100))
    @property
    def stream_page_size_max(self) -> int:
        return int(get("limits", "stream_page_size_max", 5000))
    @property
    def stream_chart_top_n(self) -> int:
        return int(get("limits", "stream_chart_top_n", 50))
    @property
    def stream_chart_max_series(self) -> int:
        return int(get("limits", "stream_chart_max_series", 10))
    @property
    def max_upload_size_bytes(self) -> int:
        return int(get("limits", "max_upload_size_mb", 1024)) * 1024 * 1024
    @property
    def max_display_cols(self) -> int:
        return int(get("limits", "max_display_cols", 50))
    @property
    def col_auto_project(self) -> int:
        return int(get("limits", "col_auto_project", 50))
    @property
    def default_query_limit(self) -> int:
        return int(get("limits", "default_query_limit", 1000))
    @property
    def streaming_default_on(self) -> bool:
        return bool(get("limits", "streaming_default_on", False))
    @property
    def stream_bg_download_default(self) -> bool:
        return bool(get("limits", "stream_bg_download_default", True))
    @property
    def error_message_max_length(self) -> int:
        return int(get("limits", "error_message_max_length", 300))
    @property
    def metadata_cache_ttl(self) -> int:
        return int(get("limits", "metadata_cache_ttl", 7200))


class _QueryGuardrailsCfg:
    """Typed accessors for the ``query_guardrails`` config section."""
    @property
    def enabled(self) -> bool: return bool(get("query_guardrails", "enabled", True))
    @property
    def max_files_warn(self) -> int: return int(get("query_guardrails", "max_files_warn", 50))
    @property
    def max_files_block(self) -> int: return int(get("query_guardrails", "max_files_block", 200))
    @property
    def max_rows_warn(self) -> int: return int(get("query_guardrails", "max_rows_warn", 10_000_000))
    @property
    def max_rows_block(self) -> int: return int(get("query_guardrails", "max_rows_block", 100_000_000))
    @property
    def require_partition_filter(self) -> bool: return bool(get("query_guardrails", "require_partition_filter", False))
    @property
    def warn_no_partition(self) -> bool: return bool(get("query_guardrails", "warn_no_partition", True))
    @property
    def warn_no_limit(self) -> bool: return bool(get("query_guardrails", "warn_no_limit", True))
    @property
    def default_limit_suggestion(self) -> int: return int(get("query_guardrails", "default_limit_suggestion", 1000))
    # ── Phase 107-B: detection-first S3 partition pruning ──
    @property
    def s3_full_scan_action(self) -> str:
        v = str(get("query_guardrails", "s3_full_scan_action", "log") or "log").lower()
        return v if v in ("log", "warn", "block") else "log"
    @property
    def s3_full_scan_min_files(self) -> int: return int(get("query_guardrails", "s3_full_scan_min_files", 50))
    @property
    def post_exec_detection(self) -> bool: return bool(get("query_guardrails", "post_exec_detection", True))


query_guardrails = _QueryGuardrailsCfg()


class _FeaturesCfg:
    @property
    def streaming_mode(self) -> str:
        return get("features", "streaming_mode", "all")

    def _parse_roles(self, key: str, default: str) -> list:
        raw = get("features", key, default)
        return [r.strip().lower() for r in raw.split(",") if r.strip()]

    @property
    def streaming_enabled_roles(self) -> list:
        return self._parse_roles("streaming_enabled_roles", "admin,analyst,viewer")
    @property
    def export_enabled_roles(self) -> list:
        return self._parse_roles("export_enabled_roles", "admin,analyst,viewer")
    @property
    def sql_editor_enabled_roles(self) -> list:
        return self._parse_roles("sql_editor_enabled_roles", "admin,analyst")
    @property
    def scheduler_enabled_roles(self) -> list:
        return self._parse_roles("scheduler_enabled_roles", "admin,analyst")
    @property
    def connections_enabled_roles(self) -> list:
        return self._parse_roles("connections_enabled_roles", "admin,analyst")
    @property
    def upload_enabled_roles(self) -> list:
        return self._parse_roles("upload_enabled_roles", "admin,analyst")
    @property
    def max_query_limit_by_role(self) -> dict:
        raw = get("features", "max_query_limit_by_role", "")
        if not raw:
            return {}
        result = {}
        for pair in raw.split(","):
            pair = pair.strip()
            if ":" in pair:
                r, v = pair.split(":", 1)
                try:
                    result[r.strip().lower()] = int(v.strip())
                except ValueError:
                    pass
        return result


class _CircuitBreakerCfg:
    @property
    def enabled(self) -> bool: return bool(get("circuit_breaker", "enabled", True))
    @property
    def failure_threshold(self) -> int: return int(get("circuit_breaker", "failure_threshold", 3))
    @property
    def cooldown_seconds(self) -> int: return int(get("circuit_breaker", "cooldown_seconds", 60))


class _ConnectionPoolCfg:
    @property
    def enabled(self) -> bool: return bool(get("connection_pool", "enabled", True))
    @property
    def max_size(self) -> int: return int(get("connection_pool", "max_size", 5))
    @property
    def idle_timeout_seconds(self) -> int: return int(get("connection_pool", "idle_timeout_seconds", 300))


class _LocalTablesCfg:
    @property
    def storage_dir(self) -> str:
        return str(get("local_tables", "storage_dir", "data/local_tables"))
    @property
    def max_size_mb(self) -> int:
        return int(get("local_tables", "max_size_mb", 10240))
    @property
    def max_tables(self) -> int:
        return int(get("local_tables", "max_tables", 100))
    @property
    def auto_discard_days(self) -> int:
        return int(get("local_tables", "auto_discard_days", 10))
    @property
    def max_upload_size_mb(self) -> int:
        return int(get("local_tables", "max_upload_size_mb", 1024))
    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024
    @property
    def cleanup_interval_hours(self) -> int:
        return int(get("local_tables", "cleanup_interval_hours", 6))


class _MaterializedViewsCfg:
    @property
    def storage_dir(self) -> str:
        return str(get("materialized_views", "storage_dir", "data/materialized"))
    @property
    def max_size_mb(self) -> int:
        return int(get("materialized_views", "max_size_mb", 10240))
    @property
    def max_views(self) -> int:
        return int(get("materialized_views", "max_views", 50))
    @property
    def refresh_timeout_seconds(self) -> int:
        return int(get("materialized_views", "refresh_timeout_seconds", 3600))
    @property
    def chunk_size(self) -> int:
        return int(get("materialized_views", "chunk_size", 500000))


class _FederationViewsCfg:
    """Typed accessors for the ``federation_views`` config section (Phase 97)."""
    @property
    def storage_dir(self) -> str:
        return str(get("federation_views", "storage_dir", "data/federation_views"))
    @property
    def max_nesting_depth(self) -> int:
        return int(get("federation_views", "max_nesting_depth", 3))
    @property
    def materialization_timeout(self) -> int:
        return int(get("federation_views", "materialization_timeout", 1800))
    @property
    def auto_cache_schema(self) -> bool:
        return bool(get("federation_views", "auto_cache_schema", True))
    @property
    def chunk_size(self) -> int:
        return int(get("federation_views", "chunk_size", 500000))


federation_views_cfg = _FederationViewsCfg()


class _DataQualityCfg:
    """Typed accessors for the ``data_quality`` config section (Phase 99)."""
    @property
    def enabled(self) -> bool: return bool(get("data_quality", "enabled", True))
    @property
    def schedule_interval_minutes(self) -> int: return int(get("data_quality", "schedule_interval_minutes", 60))
    @property
    def execution_timeout_seconds(self) -> int: return int(get("data_quality", "execution_timeout_seconds", 300))
    @property
    def result_retention_days(self) -> int: return int(get("data_quality", "result_retention_days", 90))
    @property
    def max_rules(self) -> int: return int(get("data_quality", "max_rules", 200))
    @property
    def max_concurrent_checks(self) -> int: return int(get("data_quality", "max_concurrent_checks", 5))
    @property
    def notify_on_failure(self) -> bool: return bool(get("data_quality", "notify_on_failure", True))
    @property
    def notify_severity_threshold(self) -> str: return str(get("data_quality", "notify_severity_threshold", "warning"))
    @property
    def cleanup_interval_hours(self) -> int: return int(get("data_quality", "cleanup_interval_hours", 6))
    @property
    def alert_channels(self) -> list: return list(get("data_quality", "alert_channels", []))


data_quality = _DataQualityCfg()


class _CollaborationCfg:
    """Typed accessors for the ``collaboration`` config section (Phase 114)."""
    @property
    def enabled(self) -> bool: return bool(get("collaboration", "enabled", True))
    @property
    def max_comments_per_report(self) -> int: return int(get("collaboration", "max_comments_per_report", 500))
    @property
    def change_log_retention_days(self) -> int: return int(get("collaboration", "change_log_retention_days", 365))
    @property
    def mentions_enabled(self) -> bool: return bool(get("collaboration", "mentions_enabled", True))


collaboration = _CollaborationCfg()


class _QueueCfg:
    @property
    def backend(self) -> str:
        return str(get("queue", "backend", "sqlite")).lower()
    @property
    def redis_url(self) -> str:
        return str(get("queue", "redis_url", "redis://localhost:6379/0"))
    @property
    def redis_password(self) -> str:
        return str(get("queue", "redis_password", ""))
    @property
    def redis_db(self) -> int:
        return int(get("queue", "redis_db", 0))
    @property
    def redis_ssl(self) -> bool:
        v = get("queue", "redis_ssl", False)
        if isinstance(v, str):
            return v.lower() in ("true", "1", "yes")
        return bool(v)
    @property
    def key_prefix(self) -> str:
        return str(get("queue", "key_prefix", "qs"))
    @property
    def task_ttl_hours(self) -> int:
        return int(get("queue", "task_ttl_hours", 24))


class _ExecutorCfg:
    @property
    def mode(self) -> str:
        return str(get("executor", "mode", "embedded"))
    @property
    def worker_port(self) -> int:
        return int(get("executor", "worker_port", 8002))
    @property
    def worker_host(self) -> str:
        return str(get("executor", "worker_host", "127.0.0.1"))
    @property
    def poll_interval(self) -> float:
        return float(get("executor", "poll_interval", 1.0))
    @property
    def notification_poll_interval(self) -> float:
        return float(get("executor", "notification_poll_interval", 1.0))
    @property
    def max_concurrent(self) -> int:
        return int(get("executor", "max_concurrent", 10))
    @property
    def stale_timeout_seconds(self) -> int:
        return int(get("executor", "stale_timeout_seconds", 600))
    @property
    def cleanup_interval_hours(self) -> int:
        return int(get("executor", "cleanup_interval_hours", 1))
    @property
    def task_retention_hours(self) -> int:
        return int(get("executor", "task_retention_hours", 24))
    @property
    def max_memory_per_task_gb(self) -> int:
        return int(get("executor", "max_memory_per_task_gb", 4))
    @property
    def worker_url(self) -> str:
        return f"http://{self.worker_host}:{self.worker_port}"


class _AnomalyDetectionCfg:
    @property
    def enabled(self) -> bool: return bool(get("anomaly_detection", "enabled", True))
    @property
    def z_score_threshold(self) -> float: return float(get("anomaly_detection", "z_score_threshold", 2.5))
    @property
    def min_history_runs(self) -> int: return int(get("anomaly_detection", "min_history_runs", 5))
    @property
    def window_size(self) -> int: return int(get("anomaly_detection", "window_size", 20))


class _LineageCfg:
    @property
    def auto_extract(self) -> bool: return bool(get("lineage", "auto_extract", True))
    @property
    def fallback_regex(self) -> bool: return bool(get("lineage", "fallback_regex", True))
    @property
    def max_reparse_batch(self) -> int: return int(get("lineage", "max_reparse_batch", 500))
    @property
    def snapshots_enabled(self) -> bool: return bool(get("lineage", "snapshots_enabled", True))
    @property
    def freshness_enabled(self) -> bool: return bool(get("lineage", "freshness_enabled", True))
    @property
    def snapshot_retention_days(self) -> int: return int(get("lineage", "snapshot_retention_days", 30))
    @property
    def default_stale_threshold_hours(self) -> int: return int(get("lineage", "default_stale_threshold_hours", 24))


class _SemanticLayerCfg:
    @property
    def enabled(self) -> bool: return bool(get("semantic_layer", "enabled", True))
    @property
    def auto_detect_column_types(self) -> bool: return bool(get("semantic_layer", "auto_detect_column_types", True))
    @property
    def max_columns_per_dataset(self) -> int: return int(get("semantic_layer", "max_columns_per_dataset", 500))
    @property
    def max_datasets(self) -> int: return int(get("semantic_layer", "max_datasets", 100))
    @property
    def cascading_prompts_enabled(self) -> bool: return bool(get("semantic_layer", "cascading_prompts_enabled", True))
    @property
    def drill_hierarchies_enabled(self) -> bool: return bool(get("semantic_layer", "drill_hierarchies_enabled", True))
    @property
    def aggregation_awareness_enabled(self) -> bool: return bool(get("semantic_layer", "aggregation_awareness_enabled", True))
    @property
    def default_row_limit(self) -> int: return int(get("semantic_layer", "default_row_limit", 10000))
    @property
    def synonym_matching_enabled(self) -> bool: return bool(get("semantic_layer", "synonym_matching_enabled", True))
    @property
    def max_metrics_per_dataset(self) -> int: return int(get("semantic_layer", "max_metrics_per_dataset", 50))
    @property
    def metric_validation_enabled(self) -> bool: return bool(get("semantic_layer", "metric_validation_enabled", True))


class _ChatbotCfg:
    """Column classification patterns for the AI Assistant chip suggestions."""

    @property
    def numeric_patterns(self) -> list:
        v = get("chatbot", "numeric_patterns", [])
        return v if isinstance(v, list) else [s.strip() for s in str(v).split(",") if s.strip()]

    @property
    def category_patterns(self) -> list:
        v = get("chatbot", "category_patterns", [])
        return v if isinstance(v, list) else [s.strip() for s in str(v).split(",") if s.strip()]

    @property
    def date_patterns(self) -> list:
        v = get("chatbot", "date_patterns", [])
        return v if isinstance(v, list) else [s.strip() for s in str(v).split(",") if s.strip()]

    @property
    def id_patterns(self) -> list:
        v = get("chatbot", "id_patterns", [])
        return v if isinstance(v, list) else [s.strip() for s in str(v).split(",") if s.strip()]

    @property
    def faq(self) -> dict:
        """Keyword→answer map for the AI Assistant chatbot."""
        v = get("chatbot", "faq", {})
        return {k: v2 for k, v2 in v.items() if not k.startswith("_comment")} if isinstance(v, dict) else {}

    @property
    def glossary(self) -> dict:
        """Business term→SQL fragment map applied before NL-to-SQL pattern matching."""
        v = get("chatbot", "glossary", {})
        return {k: v2 for k, v2 in v.items() if not k.startswith("_comment")} if isinstance(v, dict) else {}

    # Phase 57 — Enhanced NL Chatbot
    @property
    def semantic_context_enabled(self) -> bool:
        return bool(get("chatbot", "semantic_context_enabled", True))

    @property
    def time_intelligence_enabled(self) -> bool:
        return bool(get("chatbot", "time_intelligence_enabled", True))

    @property
    def max_pattern_alternatives(self) -> int:
        return int(get("chatbot", "max_pattern_alternatives", 3))


class _SuggestionCorrectionsCfg:
    """Typed accessors for the ``suggestion_corrections`` config section."""
    @property
    def enabled(self) -> bool: return bool(get("suggestion_corrections", "enabled", True))
    @property
    def max_corrections(self) -> int: return int(get("suggestion_corrections", "max_corrections", 1000))
    @property
    def agg_pattern_priority(self) -> bool: return bool(get("suggestion_corrections", "agg_pattern_priority", True))
    @property
    def join_correction_priority(self) -> bool: return bool(get("suggestion_corrections", "join_correction_priority", True))
    @property
    def retention_days(self) -> int: return int(get("suggestion_corrections", "retention_days", 365))
    @property
    def chart_feedback_enabled(self) -> bool: return bool(get("suggestion_corrections", "chart_feedback_enabled", True))
    @property
    def pivot_feedback_enabled(self) -> bool: return bool(get("suggestion_corrections", "pivot_feedback_enabled", True))
    @property
    def nl_feedback_lookup_enabled(self) -> bool: return bool(get("suggestion_corrections", "nl_feedback_lookup_enabled", True))
    @property
    def nl_feedback_min_similarity(self) -> float: return float(get("suggestion_corrections", "nl_feedback_min_similarity", 0.8))
    @property
    def nl_feedback_auto_return_threshold(self) -> float: return float(get("suggestion_corrections", "nl_feedback_auto_return_threshold", 0.9))


def reload():
    """Reload config from disk — called after admin changes config.json."""
    global _file_cfg, _merged, _cfg
    _file_cfg = _load_file()
    _merged = _deep_merge(_DEFAULTS, _file_cfg)
    _cfg = _apply_env(_merged)
    logger.info("Config reloaded from %s", _CONFIG_FILE)


server        = _ServerCfg()
paths         = _PathsCfg()
database      = _DatabaseCfg()
auth          = _AuthCfg()
query_engine  = _QueryEngineCfg()
s3            = _S3Cfg()
s3_results    = _S3ResultsCfg()
scheduler     = _SchedulerCfg()
cors          = _CorsCfg()
email         = _EmailCfg()
cache         = _CacheCfg()
storage       = _StorageCfg()
worker_pool   = _WorkerPoolCfg()
limits        = _LimitsCfg()
features      = _FeaturesCfg()
circuit_breaker = _CircuitBreakerCfg()
connection_pool = _ConnectionPoolCfg()
materialized_views = _MaterializedViewsCfg()
local_tables  = _LocalTablesCfg()
queue         = _QueueCfg()
executor      = _ExecutorCfg()
anomaly_detection = _AnomalyDetectionCfg()
lineage       = _LineageCfg()
semantic_layer = _SemanticLayerCfg()


class _FederationCfg:
    """Typed accessors for the ``federation`` config section."""
    @property
    def enabled(self) -> bool: return bool(get("federation", "enabled", True))
    @property
    def max_concurrent_executions(self) -> int: return int(get("federation", "max_concurrent_executions", 5))
    @property
    def execution_timeout_seconds(self) -> int: return int(get("federation", "execution_timeout_seconds", 600))
    @property
    def max_result_rows(self) -> int: return int(get("federation", "max_result_rows", 100000))
    @property
    def named_secrets_enabled(self) -> bool: return bool(get("federation", "named_secrets_enabled", True))
    @property
    def fallback_to_pragmas(self) -> bool: return bool(get("federation", "fallback_to_pragmas", True))
    @property
    def execution_history_retention_days(self) -> int: return int(get("federation", "execution_history_retention_days", 30))
    @property
    def merge_max_datasets(self) -> int: return int(get("federation", "merge_max_datasets", 5))
    @property
    def preview_row_limit(self) -> int: return int(get("federation", "preview_row_limit", 100))
    @property
    def distinct_values_limit(self) -> int: return int(get("federation", "distinct_values_limit", 500))
    @property
    def http_timeout_ms(self) -> int: return int(get("federation", "http_timeout_ms", 15000))


federation = _FederationCfg()


class _AggCacheCfg:
    """Typed accessors for the ``agg_cache`` config section."""
    @property
    def enabled(self) -> bool: return bool(get("agg_cache", "enabled", True))
    @property
    def storage_dir(self) -> str: return str(get("agg_cache", "storage_dir", "data/agg_cache"))
    @property
    def max_storage_mb(self) -> int: return int(get("agg_cache", "max_storage_mb", 5120))
    @property
    def max_entries_per_dataset(self) -> int: return int(get("agg_cache", "max_entries_per_dataset", 20))
    @property
    def default_ttl_hours(self) -> int: return int(get("agg_cache", "default_ttl_hours", 24))
    @property
    def hard_expiry_hours(self) -> int: return int(get("agg_cache", "hard_expiry_hours", 72))
    @property
    def stale_serve_enabled(self) -> bool: return bool(get("agg_cache", "stale_serve_enabled", True))
    @property
    def write_through_enabled(self) -> bool: return bool(get("agg_cache", "write_through_enabled", False))
    @property
    def refresh_timeout_seconds(self) -> int: return int(get("agg_cache", "refresh_timeout_seconds", 1800))
    @property
    def cleanup_interval_hours(self) -> int: return int(get("agg_cache", "cleanup_interval_hours", 6))
    @property
    def suggestion_enabled(self) -> bool: return bool(get("agg_cache", "suggestion_enabled", True))
    @property
    def suggestion_min_queries(self) -> int: return int(get("agg_cache", "suggestion_min_queries", 5))
    @property
    def suggestion_analysis_window_days(self) -> int: return int(get("agg_cache", "suggestion_analysis_window_days", 7))
    @property
    def incremental_default(self) -> bool: return bool(get("agg_cache", "incremental_default", False))


agg_cache = _AggCacheCfg()


class _AWSPortalCfg:
    """Typed accessors for the ``aws_portal`` config section."""
    @property
    def enabled(self) -> bool: return bool(get("aws_portal", "enabled", False))
    @property
    def portal_base_url(self) -> str: return str(get("aws_portal", "portal_base_url", ""))
    @property
    def jwt_url(self) -> str: return str(get("aws_portal", "jwt_url", ""))
    @property
    def creds_url_template(self) -> str: return str(get("aws_portal", "creds_url_template", ""))
    @property
    def account_id(self) -> str: return str(get("aws_portal", "account_id", ""))
    @property
    def role_name(self) -> str: return str(get("aws_portal", "role_name", ""))
    @property
    def sf_ref_no(self) -> str: return str(get("aws_portal", "sf_ref_no", ""))
    @property
    def service_username(self) -> str: return str(get("aws_portal", "service_username", ""))
    @property
    def service_password(self) -> str: return str(get("aws_portal", "service_password", ""))
    @property
    def proxy_url(self) -> str: return str(get("aws_portal", "proxy_url", ""))
    @property
    def proxy_host(self) -> str: return str(get("aws_portal", "proxy_host", ""))
    @property
    def proxy_port(self) -> int: return int(get("aws_portal", "proxy_port", 8080))
    @property
    def proxy_username(self) -> str: return str(get("aws_portal", "proxy_username", ""))
    @property
    def proxy_password(self) -> str: return str(get("aws_portal", "proxy_password", ""))
    @property
    def proxy_url_resolved(self) -> str:
        """Build proxy URL from separate fields, or fall back to proxy_url."""
        host = self.proxy_host
        if host:
            user = self.proxy_username
            passwd = self.proxy_password
            port = self.proxy_port
            if user:
                return f"http://{user}:{passwd}@{host}:{port}"
            return f"http://{host}:{port}"
        return self.proxy_url
    @property
    def verify_ssl(self) -> bool: return bool(get("aws_portal", "verify_ssl", False))
    @property
    def creds_ttl_seconds(self) -> int: return int(get("aws_portal", "creds_ttl_seconds", 3300))
    @property
    def timeout_seconds(self) -> int: return int(get("aws_portal", "timeout_seconds", 30))
    @property
    def auto_retry_on_expiry(self) -> bool: return bool(get("aws_portal", "auto_retry_on_expiry", True))
    @property
    def max_retry_attempts(self) -> int: return int(get("aws_portal", "max_retry_attempts", 1))
    @property
    def system_account_fallback(self) -> bool: return bool(get("aws_portal", "system_account_fallback", True))


aws_portal = _AWSPortalCfg()


class _BusinessReportsCfg:
    """Typed accessors for the ``business_reports`` config section (Phase 81 extended)."""
    @property
    def enabled(self) -> bool: return bool(get("business_reports", "enabled", True))
    @property
    def max_reports_per_user(self) -> int: return int(get("business_reports", "max_reports_per_user", 50))
    @property
    def max_sections_per_report(self) -> int: return int(get("business_reports", "max_sections_per_report", 10))
    @property
    def max_parameters_per_report(self) -> int: return int(get("business_reports", "max_parameters_per_report", 20))
    @property
    def max_running_calcs_per_report(self) -> int: return int(get("business_reports", "max_running_calcs_per_report", 15))
    @property
    def default_row_limit(self) -> int: return int(get("business_reports", "default_row_limit", 50000))
    @property
    def pdf_row_limit(self) -> int: return int(get("business_reports", "pdf_row_limit", 10000))
    @property
    def excel_row_limit(self) -> int: return int(get("business_reports", "excel_row_limit", 50000))
    @property
    def embed_row_limit(self) -> int: return int(get("business_reports", "embed_row_limit", 1000))
    @property
    def cascade_lov_limit(self) -> int: return int(get("business_reports", "cascade_lov_limit", 500))
    @property
    def page_size(self) -> int: return int(get("business_reports", "page_size", 200))
    @property
    def max_page_size(self) -> int: return int(get("business_reports", "max_page_size", 5000))
    @property
    def auto_save_interval_seconds(self) -> int: return int(get("business_reports", "auto_save_interval_seconds", 30))
    @property
    def export_formats(self) -> list: return list(get("business_reports", "export_formats", ["csv", "json"]))
    @property
    def async_execution_ttl_seconds(self) -> int: return int(get("business_reports", "async_execution_ttl_seconds", 3600))
    @property
    def pdf_page_size(self) -> str: return str(get("business_reports", "pdf_page_size", "A4 landscape"))
    @property
    def pdf_primary_color(self) -> str: return str(get("business_reports", "pdf_primary_color", "#1976d2"))
    @property
    def enable_published_view_source(self) -> bool: return bool(get("business_reports", "enable_published_view_source", True))
    @property
    def share_export_enabled(self) -> bool: return bool(get("business_reports", "share_export_enabled", True))
    @property
    def share_export_row_limit(self) -> int: return int(get("business_reports", "share_export_row_limit", 10000))


class _PivotReportsCfg:
    """Typed accessors for the ``pivot_reports`` config section (Phase 106)."""
    @property
    def enabled(self) -> bool: return bool(get("pivot_reports", "enabled", True))
    @property
    def max_row_dimensions(self) -> int: return int(get("pivot_reports", "max_row_dimensions", 3))
    @property
    def max_col_dimensions(self) -> int: return int(get("pivot_reports", "max_col_dimensions", 2))
    @property
    def max_measures(self) -> int: return int(get("pivot_reports", "max_measures", 5))
    @property
    def max_row_groups(self) -> int: return int(get("pivot_reports", "max_row_groups", 500))
    @property
    def max_col_groups(self) -> int: return int(get("pivot_reports", "max_col_groups", 50))
    @property
    def default_aggregation(self) -> str: return str(get("pivot_reports", "default_aggregation", "sum"))


class _PartitionCacheCfg:
    """Typed accessors for the ``partition_cache`` config section."""
    @property
    def l1_ttl_seconds(self) -> int: return int(get("partition_cache", "l1_ttl_seconds", 300))
    @property
    def l2_ttl_seconds(self) -> int: return int(get("partition_cache", "l2_ttl_seconds", 18000))
    @property
    def l1_max_entries(self) -> int: return int(get("partition_cache", "l1_max_entries", 100))


class _ReportCatalogCfg:
    """Typed accessors for the ``report_catalog`` config section (Phase 58)."""
    @property
    def enabled(self) -> bool: return bool(get("report_catalog", "enabled", True))
    @property
    def certification_enabled(self) -> bool: return bool(get("report_catalog", "certification_enabled", True))
    @property
    def template_gallery_enabled(self) -> bool: return bool(get("report_catalog", "template_gallery_enabled", True))
    @property
    def sharing_enabled(self) -> bool: return bool(get("report_catalog", "sharing_enabled", True))
    @property
    def embed_enabled(self) -> bool: return bool(get("report_catalog", "embed_enabled", True))
    @property
    def max_shares_per_report(self) -> int: return int(get("report_catalog", "max_shares_per_report", 10))
    @property
    def max_embed_tokens_per_report(self) -> int: return int(get("report_catalog", "max_embed_tokens_per_report", 5))
    @property
    def share_default_expiry_hours(self) -> int: return int(get("report_catalog", "share_default_expiry_hours", 720))
    @property
    def embed_default_expiry_days(self) -> int: return int(get("report_catalog", "embed_default_expiry_days", 90))
    @property
    def embed_max_row_limit(self) -> int: return int(get("report_catalog", "embed_max_row_limit", 5000))
    @property
    def template_categories(self) -> list: return list(get("report_catalog", "template_categories",
                                                           ["Sales", "Finance", "HR", "Operations", "Marketing", "Custom"]))


class _BusinessPortalCfg:
    """Typed accessors for the ``business_portal`` config section (Phase 59)."""
    @property
    def enabled(self) -> bool: return bool(get("business_portal", "enabled", True))
    @property
    def welcome_message(self) -> str: return str(get("business_portal", "welcome_message", "Welcome to QueryStudio"))
    @property
    def welcome_subtitle(self) -> str: return str(get("business_portal", "welcome_subtitle", "Your enterprise data platform"))
    @property
    def recent_reports_limit(self) -> int: return int(get("business_portal", "recent_reports_limit", 8))
    @property
    def favorites_limit(self) -> int: return int(get("business_portal", "favorites_limit", 12))
    @property
    def certified_templates_limit(self) -> int: return int(get("business_portal", "certified_templates_limit", 6))
    @property
    def recent_activity_limit(self) -> int: return int(get("business_portal", "recent_activity_limit", 10))
    @property
    def quick_actions_enabled(self) -> bool: return bool(get("business_portal", "quick_actions_enabled", True))
    @property
    def kpi_cards_enabled(self) -> bool: return bool(get("business_portal", "kpi_cards_enabled", True))


business_reports = _BusinessReportsCfg()
pivot_reports = _PivotReportsCfg()
chatbot       = _ChatbotCfg()
suggestion_corrections = _SuggestionCorrectionsCfg()
partition_cache = _PartitionCacheCfg()
report_catalog = _ReportCatalogCfg()
business_portal = _BusinessPortalCfg()


class _DeliveryCfg:
    """Typed accessors for the ``delivery`` config section (Phase 60)."""
    @property
    def enabled(self) -> bool: return bool(get("delivery", "enabled", True))
    @property
    def max_subscriptions_per_user(self) -> int: return int(get("delivery", "max_subscriptions_per_user", 50))
    @property
    def max_recipients_per_subscription(self) -> int: return int(get("delivery", "max_recipients_per_subscription", 20))
    @property
    def retry_max_attempts(self) -> int: return int(get("delivery", "retry_max_attempts", 3))
    @property
    def retry_backoff_minutes(self) -> int: return int(get("delivery", "retry_backoff_minutes", 5))
    @property
    def delivery_history_retention_days(self) -> int: return int(get("delivery", "delivery_history_retention_days", 90))
    @property
    def max_pdf_rows(self) -> int: return int(get("delivery", "max_pdf_rows", 10000))
    @property
    def unsubscribe_token_expiry_days(self) -> int: return int(get("delivery", "unsubscribe_token_expiry_days", 365))
    @property
    def batch_size(self) -> int: return int(get("delivery", "batch_size", 20))
    @property
    def check_interval_minutes(self) -> int: return int(get("delivery", "check_interval_minutes", 5))


delivery = _DeliveryCfg()


class _RestApiCfg:
    """Typed accessors for the ``rest_api`` config section (Phase 61)."""
    @property
    def enabled(self) -> bool: return bool(get("rest_api", "enabled", True))
    @property
    def max_response_size_mb(self) -> int: return int(get("rest_api", "max_response_size_mb", 50))
    @property
    def max_rows_per_query(self) -> int: return int(get("rest_api", "max_rows_per_query", 100000))
    @property
    def default_timeout_seconds(self) -> int: return int(get("rest_api", "default_timeout_seconds", 30))
    @property
    def max_timeout_seconds(self) -> int: return int(get("rest_api", "max_timeout_seconds", 300))
    @property
    def oauth2_token_cache_seconds(self) -> int: return int(get("rest_api", "oauth2_token_cache_seconds", 3500))
    @property
    def flatten_max_depth(self) -> int: return int(get("rest_api", "flatten_max_depth", 5))


rest_api = _RestApiCfg()


class _HorizontalWorkersCfg:
    """Typed accessors for the ``horizontal_workers`` config section (Phase 45)."""
    @property
    def registry_backend(self) -> str: return get("horizontal_workers", "registry_backend", "auto")
    @property
    def heartbeat_interval_seconds(self) -> int: return int(get("horizontal_workers", "heartbeat_interval_seconds", 15))
    @property
    def heartbeat_ttl_seconds(self) -> int: return int(get("horizontal_workers", "heartbeat_ttl_seconds", 45))
    @property
    def worker_eviction_seconds(self) -> int: return int(get("horizontal_workers", "worker_eviction_seconds", 120))
    @property
    def max_workers_per_host(self) -> int: return int(get("horizontal_workers", "max_workers_per_host", 10))
    @property
    def enable_load_aware_claiming(self) -> bool: return bool(get("horizontal_workers", "enable_load_aware_claiming", True))
    @property
    def memory_threshold_pct(self) -> int: return int(get("horizontal_workers", "memory_threshold_pct", 85))
    @property
    def cpu_threshold_pct(self) -> int: return int(get("horizontal_workers", "cpu_threshold_pct", 90))
    @property
    def metrics_retention_hours(self) -> int: return int(get("horizontal_workers", "metrics_retention_hours", 24))


horizontal_workers = _HorizontalWorkersCfg()


class _StreamingCfg:
    """Typed accessors for the ``streaming`` config section (Phase 72)."""
    @property
    def cancel_enabled(self) -> bool: return bool(get("streaming", "cancel_enabled", True))
    @property
    def max_active_streams(self) -> int: return int(get("streaming", "max_active_streams", 50))
    @property
    def cancel_check_interval_rows(self) -> int: return int(get("streaming", "cancel_check_interval_rows", 5000))


streaming = _StreamingCfg()


class _PresignedUrlCfg:
    """Typed accessors for the ``presigned_url`` config section (Phase 74)."""
    @property
    def expiry_seconds(self) -> int: return int(get("presigned_url", "expiry_seconds", 900))
    @property
    def retry_enabled(self) -> bool: return bool(get("presigned_url", "retry_enabled", True))
    @property
    def max_retries(self) -> int: return int(get("presigned_url", "max_retries", 2))
    @property
    def retry_on_403(self) -> bool: return bool(get("presigned_url", "retry_on_403", True))
    @property
    def retry_delay_seconds(self) -> int: return int(get("presigned_url", "retry_delay_seconds", 1))
    @property
    def download_timeout_seconds(self) -> int: return int(get("presigned_url", "download_timeout_seconds", 120))


presigned_url = _PresignedUrlCfg()


class _S3ValidationCfg:
    """Typed accessors for the ``s3_validation`` config section (Phase 78)."""
    @property
    def bucket_name_regex_aws(self) -> str:
        return str(get("s3_validation", "bucket_name_regex_aws", r"^[a-z0-9]([a-z0-9\-]{1,61}[a-z0-9])?$"))
    @property
    def bucket_name_regex_onprem(self) -> str:
        return str(get("s3_validation", "bucket_name_regex_onprem", r"^[a-zA-Z0-9][a-zA-Z0-9\-_\.]{0,253}[a-zA-Z0-9]$"))
    @property
    def validate_bucket_on_create(self) -> bool:
        return bool(get("s3_validation", "validate_bucket_on_create", True))
    @property
    def validate_arn_format(self) -> bool:
        return bool(get("s3_validation", "validate_arn_format", True))
    @property
    def arn_regex(self) -> str:
        return str(get("s3_validation", "arn_regex", r"^arn:(aws|aws-cn|aws-us-gov):iam::\d{12}:role\/[\w+=,.@\-\/]{1,256}$"))
    @property
    def root_prefix_test_on_create(self) -> bool:
        return bool(get("s3_validation", "root_prefix_test_on_create", True))
    @property
    def warn_unsupported_partition_ops(self) -> bool:
        return bool(get("s3_validation", "warn_unsupported_partition_ops", True))
    @property
    def max_folder_browser_items(self) -> int:
        return int(get("s3_validation", "max_folder_browser_items", 500))
    @property
    def partition_refresh_mutex_timeout_seconds(self) -> int:
        return int(get("s3_validation", "partition_refresh_mutex_timeout_seconds", 30))
    @property
    def file_list_max_files(self) -> int:
        return int(get("s3_validation", "file_list_max_files", 5000))


s3_validation = _S3ValidationCfg()


class _DuckDBCfg:
    """Typed accessors for the ``duckdb`` config section (Phase 79)."""
    @property
    def circuit_breaker_enabled(self) -> bool:
        return bool(get("duckdb", "circuit_breaker_enabled", True))
    @property
    def retry_on_engine_error(self) -> bool:
        return bool(get("duckdb", "retry_on_engine_error", True))
    @property
    def retry_max_attempts(self) -> int:
        return int(get("duckdb", "retry_max_attempts", 1))
    @property
    def retry_delay_seconds(self) -> float:
        return float(get("duckdb", "retry_delay_seconds", 1))


duckdb_cfg = _DuckDBCfg()


class _FeedGenerationAirflowCfg:
    """Typed accessors for ``feed_generation.airflow`` sub-section."""
    @property
    def enabled(self) -> bool: return bool(get("feed_generation", "airflow", {}).get("enabled", False))
    @property
    def base_url(self) -> str: return str(get("feed_generation", "airflow", {}).get("base_url", "http://airflow:8080"))
    @property
    def auth_type(self) -> str: return str(get("feed_generation", "airflow", {}).get("auth_type", "basic"))
    @property
    def username(self) -> str: return str(get("feed_generation", "airflow", {}).get("username", ""))
    @property
    def password(self) -> str: return str(get("feed_generation", "airflow", {}).get("password", ""))
    @property
    def default_dag_id(self) -> str: return str(get("feed_generation", "airflow", {}).get("default_dag_id", "querystudio_feed"))
    @property
    def output_s3_bucket(self) -> str: return str(get("feed_generation", "airflow", {}).get("output_s3_bucket", ""))
    @property
    def output_s3_prefix(self) -> str: return str(get("feed_generation", "airflow", {}).get("output_s3_prefix", "feed-output/"))
    @property
    def poll_interval_seconds(self) -> int: return int(get("feed_generation", "airflow", {}).get("poll_interval_seconds", 10))
    @property
    def poll_timeout_seconds(self) -> int: return int(get("feed_generation", "airflow", {}).get("poll_timeout_seconds", 3600))
    @property
    def use_callback_webhook(self) -> bool: return bool(get("feed_generation", "airflow", {}).get("use_callback_webhook", False))


class _FeedGenerationSparkLivyCfg:
    """Typed accessors for ``feed_generation.spark_livy`` sub-section."""
    @property
    def enabled(self) -> bool: return bool(get("feed_generation", "spark_livy", {}).get("enabled", False))
    @property
    def base_url(self) -> str: return str(get("feed_generation", "spark_livy", {}).get("base_url", "http://livy:8998"))
    @property
    def auth_type(self) -> str: return str(get("feed_generation", "spark_livy", {}).get("auth_type", "none"))
    @property
    def username(self) -> str: return str(get("feed_generation", "spark_livy", {}).get("username", ""))
    @property
    def password(self) -> str: return str(get("feed_generation", "spark_livy", {}).get("password", ""))
    @property
    def default_script_path(self) -> str: return str(get("feed_generation", "spark_livy", {}).get("default_script_path", ""))
    @property
    def driver_memory(self) -> str: return str(get("feed_generation", "spark_livy", {}).get("driver_memory", "2g"))
    @property
    def executor_memory(self) -> str: return str(get("feed_generation", "spark_livy", {}).get("executor_memory", "4g"))
    @property
    def num_executors(self) -> int: return int(get("feed_generation", "spark_livy", {}).get("num_executors", 4))
    @property
    def spark_conf(self) -> dict: return dict(get("feed_generation", "spark_livy", {}).get("spark_conf", {}))
    @property
    def poll_interval_seconds(self) -> int: return int(get("feed_generation", "spark_livy", {}).get("poll_interval_seconds", 15))
    @property
    def poll_timeout_seconds(self) -> int: return int(get("feed_generation", "spark_livy", {}).get("poll_timeout_seconds", 7200))


class _FeedGenerationSftpCfg:
    """Typed accessors for ``feed_generation.sftp`` sub-section."""
    @property
    def connect_timeout_seconds(self) -> int: return int(get("feed_generation", "sftp", {}).get("connect_timeout_seconds", 30))
    @property
    def upload_timeout_seconds(self) -> int: return int(get("feed_generation", "sftp", {}).get("upload_timeout_seconds", 300))


class _FeedGenerationCfg:
    """Typed accessors for the ``feed_generation`` config section (Phase 76)."""
    airflow = _FeedGenerationAirflowCfg()
    spark_livy = _FeedGenerationSparkLivyCfg()
    sftp = _FeedGenerationSftpCfg()

    @property
    def enabled(self) -> bool: return bool(get("feed_generation", "enabled", True))
    @property
    def max_concurrent_native(self) -> int: return int(get("feed_generation", "max_concurrent_native", 3))
    @property
    def output_dir(self) -> str: return str(get("feed_generation", "output_dir", "data/feeds"))
    @property
    def max_output_rows(self) -> int: return int(get("feed_generation", "max_output_rows", 1000000))
    @property
    def max_file_size_mb(self) -> int: return int(get("feed_generation", "max_file_size_mb", 500))
    @property
    def default_output_format(self) -> str: return str(get("feed_generation", "default_output_format", "csv"))
    @property
    def filename_template(self) -> str: return str(get("feed_generation", "filename_template", "{name}_{date}.{ext}"))
    @property
    def auto_route_threshold_rows(self) -> int: return int(get("feed_generation", "auto_route_threshold_rows", 500000))
    @property
    def retry_max_attempts(self) -> int: return int(get("feed_generation", "retry_max_attempts", 2))
    @property
    def retry_delay_seconds(self) -> int: return int(get("feed_generation", "retry_delay_seconds", 60))
    @property
    def execution_history_retention_days(self) -> int: return int(get("feed_generation", "execution_history_retention_days", 90))
    @property
    def cleanup_interval_hours(self) -> int: return int(get("feed_generation", "cleanup_interval_hours", 6))
    @property
    def chunk_size(self) -> int: return int(get("feed_generation", "chunk_size", 100000))
    @property
    def airflow_enabled(self) -> bool: return self.airflow.enabled
    @property
    def livy_enabled(self) -> bool: return self.spark_livy.enabled


feed_generation = _FeedGenerationCfg()


class _PublishedViewsCfg:
    """Typed accessors for the ``published_views`` config section (Phase 75)."""
    @property
    def enabled(self) -> bool: return bool(get("published_views", "enabled", True))
    @property
    def max_concurrent(self) -> int: return int(get("published_views", "max_concurrent", 5))
    @property
    def default_cache_ttl_seconds(self) -> int: return int(get("published_views", "default_cache_ttl_seconds", 300))
    @property
    def max_cache_size_mb(self) -> int: return int(get("published_views", "max_cache_size_mb", 2048))
    @property
    def cache_dir(self) -> str: return str(get("published_views", "cache_dir", "data/published_cache"))
    @property
    def default_rate_limit(self) -> str: return str(get("published_views", "default_rate_limit", "60/minute"))
    @property
    def max_rate_limit(self) -> str: return str(get("published_views", "max_rate_limit", "300/minute"))
    @property
    def default_row_limit(self) -> int: return int(get("published_views", "default_row_limit", 1000))
    @property
    def max_row_limit(self) -> int: return int(get("published_views", "max_row_limit", 50000))
    @property
    def api_key_prefix(self) -> str: return str(get("published_views", "api_key_prefix", "qs_"))
    @property
    def access_log_retention_days(self) -> int: return int(get("published_views", "access_log_retention_days", 90))
    @property
    def cleanup_interval_hours(self) -> int: return int(get("published_views", "cleanup_interval_hours", 6))

    param_substitution_enabled: bool = property(lambda self: bool(get("published_views", "param_substitution_enabled", True)))   # type: ignore[assignment]
    dedup_timeout_seconds:       int  = property(lambda self: int(get("published_views", "dedup_timeout_seconds", 60)))           # type: ignore[assignment]

    @property
    def ad_group_fetch_fail_mode(self) -> str:
        """Phase 83H: 'deny' | 'allow' — what to do when AD group fetch fails."""
        return str(get("published_views", "ad_group_fetch_fail_mode", "deny"))

    @property
    def kafka(self) -> "_KafkaCfg":
        """Phase 98-I: Kafka-driven cache invalidation config sub-section."""
        return _KafkaCfg()


class _KafkaCfg:
    """Typed accessors for published_views.kafka sub-section (Phase 98-I)."""
    @property
    def enabled(self) -> bool: return bool(get("published_views", "kafka_enabled", False))
    @property
    def bootstrap_servers(self) -> str: return str(get("published_views", "kafka_bootstrap_servers", "localhost:9092"))
    @property
    def topic_pattern(self) -> str: return str(get("published_views", "kafka_topic_pattern", "{table}_{partition_col}"))
    @property
    def consumer_group(self) -> str: return str(get("published_views", "kafka_consumer_group", "querystudio_cache_invalidation"))
    @property
    def auto_offset_reset(self) -> str: return str(get("published_views", "kafka_auto_offset_reset", "latest"))
    @property
    def session_timeout_ms(self) -> int: return int(get("published_views", "kafka_session_timeout_ms", 30000))


published_views = _PublishedViewsCfg()


class _SmartPredictionsCfg:
    """Typed accessors for the ``smart_predictions`` config section (Phase 77)."""
    @property
    def enabled(self) -> bool: return bool(get("smart_predictions", "enabled", True))
    @property
    def max_chart_suggestions(self) -> int: return int(get("smart_predictions", "max_chart_suggestions", 5))
    @property
    def max_pivot_suggestions(self) -> int: return int(get("smart_predictions", "max_pivot_suggestions", 4))
    @property
    def profile_max_top_values(self) -> int: return int(get("smart_predictions", "profile_max_top_values", 10))
    @property
    def outlier_method(self) -> str: return str(get("smart_predictions", "outlier_method", "iqr"))
    @property
    def outlier_iqr_multiplier(self) -> float: return float(get("smart_predictions", "outlier_iqr_multiplier", 1.5))
    @property
    def profile_sample_limit(self) -> int: return int(get("smart_predictions", "profile_sample_limit", 100000))
    @property
    def inline_chart_enabled(self) -> bool: return bool(get("smart_predictions", "inline_chart_enabled", True))


smart_predictions = _SmartPredictionsCfg()


class _LocalLLMCfg:
    """Typed accessors for the ``local_llm`` config section (Phase 95)."""
    @property
    def enabled(self) -> bool: return bool(get("local_llm", "enabled", False))
    @property
    def model_path(self) -> str: return str(get("local_llm", "model_path", ""))
    @property
    def model_name(self) -> str: return str(get("local_llm", "model_name", ""))
    @property
    def n_ctx(self) -> int: return int(get("local_llm", "n_ctx", 2048))
    @property
    def n_gpu_layers(self) -> int: return int(get("local_llm", "n_gpu_layers", 0))
    @property
    def max_tokens(self) -> int: return int(get("local_llm", "max_tokens", 256))
    @property
    def temperature(self) -> float: return float(get("local_llm", "temperature", 0.1))
    @property
    def embedder_model(self) -> str: return str(get("local_llm", "embedder_model", "all-MiniLM-L6-v2"))
    @property
    def embedder_enabled(self) -> bool: return bool(get("local_llm", "embedder_enabled", True))
    @property
    def sql_generation_enabled(self) -> bool: return bool(get("local_llm", "sql_generation_enabled", True))
    @property
    def startup_preload(self) -> bool: return bool(get("local_llm", "startup_preload", True))
    @property
    def generation_timeout_seconds(self) -> int: return int(get("local_llm", "generation_timeout_seconds", 30))
    @property
    def finance_domain_hints(self) -> bool: return bool(get("local_llm", "finance_domain_hints", True))


local_llm = _LocalLLMCfg()


class _OnboardingCfg:
    """Typed accessors for the ``onboarding`` config section (Phase 100)."""
    @property
    def enabled(self) -> bool: return bool(get("onboarding", "enabled", True))
    @property
    def auto_show_on_first_login(self) -> bool: return bool(get("onboarding", "auto_show_on_first_login", True))
    @property
    def available_tours(self) -> list: return list(get("onboarding", "available_tours", ["getting_started"]))
    @property
    def default_tour(self) -> str: return str(get("onboarding", "default_tour", "getting_started"))


onboarding = _OnboardingCfg()


class _AdminGovernanceCfg:
    """Typed accessors for the ``admin_governance`` config section (Phase 102).

    Controls per-role rate limits, daily query quotas, export restrictions,
    and per-user resource caps. Admins can tune all values via the Governance
    tab without redeployment — values are read fresh on every request, so
    changes take effect instantly.
    """

    # ── Master kill switch ─────────────────────────────────────────────────
    @property
    def enabled(self) -> bool:
        return bool(get("admin_governance", "enabled", True))

    # ── Per-role rate limits (queries/min) ─────────────────────────────────
    @property
    def rate_limit_admin(self) -> int:
        return int(get("admin_governance", "rate_limit_admin", 120))

    @property
    def rate_limit_analyst(self) -> int:
        return int(get("admin_governance", "rate_limit_analyst", 60))

    @property
    def rate_limit_viewer(self) -> int:
        return int(get("admin_governance", "rate_limit_viewer", 30))

    # ── Daily query quotas (0 = unlimited) ─────────────────────────────────
    @property
    def daily_quota_admin(self) -> int:
        return int(get("admin_governance", "daily_quota_admin", 0))

    @property
    def daily_quota_analyst(self) -> int:
        return int(get("admin_governance", "daily_quota_analyst", 1000))

    @property
    def daily_quota_viewer(self) -> int:
        return int(get("admin_governance", "daily_quota_viewer", 200))

    # ── Export format restrictions (CSV list per role) ─────────────────────
    @property
    def export_formats_admin(self) -> str:
        return str(get("admin_governance", "export_formats_admin", "csv,excel,json,pdf"))

    @property
    def export_formats_analyst(self) -> str:
        return str(get("admin_governance", "export_formats_analyst", "csv,excel,json"))

    @property
    def export_formats_viewer(self) -> str:
        return str(get("admin_governance", "export_formats_viewer", "csv"))

    @property
    def export_rate_limit_per_minute(self) -> int:
        return int(get("admin_governance", "export_rate_limit_per_minute", 10))

    @property
    def export_max_file_size_mb(self) -> int:
        return int(get("admin_governance", "export_max_file_size_mb", 500))

    # ── Per-user resource caps (0 = unlimited) ─────────────────────────────
    @property
    def max_connections_per_user(self) -> int:
        return int(get("admin_governance", "max_connections_per_user", 20))

    @property
    def max_schedules_per_user(self) -> int:
        return int(get("admin_governance", "max_schedules_per_user", 10))

    @property
    def max_published_views_per_user(self) -> int:
        return int(get("admin_governance", "max_published_views_per_user", 20))

    # ── Misc tuning ────────────────────────────────────────────────────────
    @property
    def audit_log_max_results(self) -> int:
        return int(get("admin_governance", "audit_log_max_results", 1000))

    @property
    def daily_quota_cache_ttl_seconds(self) -> int:
        """TTL for the per-user daily-quota counter cache — avoids DB hit per request."""
        return int(get("admin_governance", "daily_quota_cache_ttl_seconds", 60))

    # ── Helpers — role-based lookup ────────────────────────────────────────
    # Phase 107-F: ``super_admin`` is mapped to ``admin`` for all governance
    # lookups (rate limits, quotas, export formats) — break-glass role inherits
    # the highest tier of every limit.
    def rate_limit_for_role(self, role: str) -> int:
        """Return the per-minute rate limit for a given role name."""
        role = (role or "viewer").lower()
        if role in ADMIN_TIER_ROLES:
            return self.rate_limit_admin
        if role == "analyst":
            return self.rate_limit_analyst
        return self.rate_limit_viewer

    def daily_quota_for_role(self, role: str) -> int:
        """Return the daily query quota for a role (0 = unlimited)."""
        role = (role or "viewer").lower()
        if role in ADMIN_TIER_ROLES:
            return self.daily_quota_admin
        if role == "analyst":
            return self.daily_quota_analyst
        return self.daily_quota_viewer

    def export_formats_for_role(self, role: str) -> set:
        """Return the set of allowed export formats for a role."""
        role = (role or "viewer").lower()
        if role in ADMIN_TIER_ROLES:
            raw = self.export_formats_admin
        elif role == "analyst":
            raw = self.export_formats_analyst
        else:
            raw = self.export_formats_viewer
        return {fmt.strip().lower() for fmt in raw.split(",") if fmt.strip()}


admin_governance = _AdminGovernanceCfg()
