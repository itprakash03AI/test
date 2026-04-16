"""
Active Directory / LDAP authentication for QueryStudio.

When auth.type = "ad" in config.json, all API requests must include an
Authorization: Bearer <base64(user:password)> header (HTTP Basic encoded
as Bearer for API compatibility) OR a session token obtained from POST /auth/login.

AD configuration (config.json or QUERYSTUDIO_AUTH_* env vars):
  ad_server              – LDAP server URL  e.g. "ldap://ad.example.com"
  ad_domain              – Windows domain   e.g. "EXAMPLE"
  ad_base_dn             – Search base      e.g. "DC=example,DC=com"
  ad_user_search_filter  – LDAP filter with {username} placeholder
  ad_group_attribute     – Attribute holding group memberships (memberOf)
  ad_admin_groups        – Comma-separated list of AD groups → admin role

Requires: ldap3   (pip install ldap3)
"""
from __future__ import annotations

import base64
import hashlib
import logging
import re
import secrets
from typing import Optional

from core.roles import ADMIN_TIER_ROLES

logger = logging.getLogger(__name__)

# ── Password hashing (PBKDF2-SHA256, stdlib only) ────────────────────────────

_PBKDF2_PREFIX = "$pbkdf2$"
_PBKDF2_ITERATIONS = 260_000  # OWASP 2024 recommendation


def hash_password(password: str) -> str:
    """Hash a password using PBKDF2-SHA256 with a random 16-byte salt."""
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), _PBKDF2_ITERATIONS
    )
    return f"{_PBKDF2_PREFIX}{salt}${h.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against a stored PBKDF2 hash.

    Also accepts plain-text passwords (legacy/migration) — if the stored value
    doesn't start with the PBKDF2 prefix, it's compared as plain text.
    """
    if stored_hash.startswith(_PBKDF2_PREFIX):
        # Format: $pbkdf2$<salt>$<hash_hex>
        rest = stored_hash[len(_PBKDF2_PREFIX):]
        if "$" not in rest:
            return False
        salt, expected_hex = rest.split("$", 1)
        h = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), _PBKDF2_ITERATIONS
        )
        return secrets.compare_digest(h.hex(), expected_hex)
    # Plain-text fallback (pre-migration)
    return secrets.compare_digest(password, stored_hash)


def _sanitize_ldap(value: str) -> str:
    """Escape special LDAP filter characters to prevent injection."""
    # RFC 4515 § 3: escape *, (, ), \\, NUL
    value = value.replace("\\", "\\5c")
    value = value.replace("*", "\\2a")
    value = value.replace("(", "\\28")
    value = value.replace(")", "\\29")
    value = value.replace("\x00", "\\00")
    return value


def _ldap3():
    try:
        import ldap3
        return ldap3
    except ImportError:
        raise RuntimeError(
            "ldap3 is not installed. Run: pip install ldap3  then restart the backend."
        )


def _resolve_role(username: str, groups: list) -> str:
    """
    Determine user role: admin > analyst > viewer (highest wins).

    Resolution order:
      1. Explicit per-user role from config (user_roles)
      2. AD group-based role (ad_admin_groups > ad_analyst_groups > ad_viewer_groups)
      3. Default: viewer (least privilege)
    """
    from core.config import auth as _auth
    user_roles = _auth.user_roles

    # 1. Explicit per-user role
    explicit = user_roles.get(username.lower())
    if explicit in ("admin", "analyst", "viewer"):
        return explicit

    # 2. AD group-based role (highest priority wins)
    lower_groups = {g.lower() for g in groups}
    if set(_auth.ad_admin_groups) & lower_groups:
        return "admin"
    if set(_auth.ad_analyst_groups) & lower_groups:
        return "analyst"
    if set(_auth.ad_viewer_groups) & lower_groups:
        return "viewer"

    # 3. Default: viewer (least privilege)
    return "viewer"


def _make_ldap_server(ldap3, server_url: str, connect_timeout: int, use_ssl: bool, tls_validate: bool):
    """Build an ldap3 Server object with TLS and timeout config."""
    tls = None
    if use_ssl or server_url.startswith("ldaps://"):
        import ssl as _ssl
        validate = _ssl.CERT_REQUIRED if tls_validate else _ssl.CERT_NONE
        tls = ldap3.Tls(validate=validate)

    return ldap3.Server(
        server_url,
        get_info=ldap3.NONE,          # don't pre-fetch schema — avoids extra round-trip on connect
        connect_timeout=connect_timeout or None,
        use_ssl=(use_ssl or server_url.startswith("ldaps://")),
        tls=tls,
    )


def _catch_ldap_connection_errors(ldap3):
    """Return a tuple of ldap3 exception types that indicate a connection/auth failure."""
    return (
        ldap3.core.exceptions.LDAPBindError,
        ldap3.core.exceptions.LDAPSocketOpenError,
        ldap3.core.exceptions.LDAPSocketSendError,
        ldap3.core.exceptions.LDAPSocketReceiveError,
        ldap3.core.exceptions.LDAPStartTLSError,
        ldap3.core.exceptions.LDAPSSLConfigurationError,
        ldap3.core.exceptions.LDAPConnectionIsReadOnlyError,
        OSError,          # plain socket errors (e.g. connection refused, host unreachable)
    )


def lookup_ad_user(username: str) -> Optional[dict]:
    """
    Look up a user in Active Directory by sAMAccountName (Windows ID).

    Uses the configured service account (ad_service_account / ad_service_password)
    to bind and search — no user password required.

    Returns user-info dict on success:
        { "username": str, "display_name": str, "email": str,
          "groups": [str], "role": str }
    Returns None if not found or if service account is not configured.
    """
    from core.config import auth as _auth

    if _auth.type != "ad":
        return None

    svc_account = _auth.ad_service_account
    svc_password = _auth.ad_service_password
    if not svc_account or not svc_password:
        logger.warning("AD service account not configured — cannot look up users")
        return None

    ldap3 = _ldap3()

    server_url    = _auth.ad_server
    base_dn       = _auth.ad_base_dn
    search_filter = _auth.ad_user_search_filter.format(username=_sanitize_ldap(username))
    group_attr    = _auth.ad_group_attribute

    server = _make_ldap_server(
        ldap3, server_url, _auth.ad_connect_timeout, _auth.ad_use_ssl, _auth.ad_tls_validate
    )
    _receive_timeout = getattr(_auth, "ad_receive_timeout", 10)
    try:
        conn = ldap3.Connection(
            server,
            user=svc_account,
            password=svc_password,
            authentication=ldap3.SIMPLE,
            receive_timeout=_receive_timeout,
            auto_bind=True,
        )
    except _catch_ldap_connection_errors(ldap3) as e:
        logger.error("AD service account bind failed (%s: %s) — check ad_server / ad_service_account / ad_service_password",
                     type(e).__name__, e)
        return None

    conn.search(
        search_base=base_dn,
        search_filter=search_filter,
        attributes=["displayName", "mail", "sAMAccountName", group_attr],
    )

    if not conn.entries:
        conn.unbind()
        return None

    entry = conn.entries[0]
    display_name = str(entry.displayName) if hasattr(entry, "displayName") else username
    email        = str(entry.mail)        if hasattr(entry, "mail")        else ""
    sam          = str(entry.sAMAccountName) if hasattr(entry, "sAMAccountName") else username

    raw_groups: list = []
    if hasattr(entry, group_attr):
        raw_groups = list(getattr(entry, group_attr))

    groups = []
    for dn in raw_groups:
        cn = dn.split(",")[0].replace("CN=", "").replace("cn=", "").strip()
        groups.append(cn)

    role = _resolve_role(username, groups)

    conn.unbind()
    return {
        "username": sam,
        "display_name": display_name,
        "email": email,
        "groups": groups,
        "role": role,
    }


def _try_super_admin_login(
    username: str, password: str, *, record_login: bool = False,
) -> Optional[dict]:
    """Phase 107-F: break-glass login against the SQLite super_admins table.

    Runs as a FALLBACK after normal auth fails, so that an operator can always
    recover access — even when ``auth.type == "ad"`` and AD is unreachable.

    ``record_login`` must be explicitly set to ``True`` by the caller when this
    is a fresh interactive login (e.g. the ``/auth/login`` endpoint). Basic-auth
    fall-through (``deps.get_current_user``) MUST call with the default
    ``record_login=False`` — otherwise every API request by a super_admin would
    issue an UPDATE + WAL fsync for ``last_login_at``. Simplify-review H2.

    Fail-open: any exception returns ``None`` and the caller continues.
    """
    try:
        from api.deps import _db_manager  # populated at startup
        if _db_manager is None:
            return None
        sa = _db_manager.get_super_admin_by_username(username)
        if not sa or not sa.get("is_active"):
            return None
        if not verify_password(password, sa.get("password_hash") or ""):
            return None
        if record_login:
            try:
                _db_manager.record_super_admin_login(username)
            except Exception:
                pass
            logger.info("super_admin break-glass login: %s", username)
        return {
            "username": username,
            "display_name": f"Super Admin ({username})",
            "email": "",
            "groups": [],
            "is_admin": True,
            "role": "super_admin",
        }
    except Exception:
        logger.exception("super_admin auth check failed; falling through to normal auth")
        return None


def authenticate_user(username: str, password: str) -> Optional[dict]:
    """
    Authenticate `username` / `password` against the configured auth backend.

    **Does NOT check the super_admin table.** This function is called on
    every Basic-auth API request via ``deps.get_current_user``, so a DB
    lookup per request would be a perf regression (simplify H1). Break-glass
    super_admin is ONLY available through the interactive UI login endpoint —
    see :func:`authenticate_interactive`.

    Supports three modes (auth.type in config):
      - "none"  → accept any credentials, return admin guest
      - "local" → validate against config.json local_users
      - "ad"    → validate against Active Directory / LDAP

    Returns a user-info dict on success:
        { "username": str, "display_name": str, "email": str,
          "groups": [str], "is_admin": bool, "role": str }
    Returns None on failure.
    """
    from core.config import auth as _auth

    # ── Auth disabled — accept any credentials. ──
    if _auth.type == "none":
        return {"username": username, "display_name": username,
                "email": "", "groups": [], "is_admin": True, "role": "admin"}

    # ── Local auth — validate against config.json users ──
    if _auth.type == "local":
        local_users = _auth.local_users
        if username in local_users and verify_password(password, local_users[username]):
            role = _resolve_role(username, [])
            return {
                "username": username,
                "display_name": username.title(),
                "email": "",
                "groups": [],
                "is_admin": role in ADMIN_TIER_ROLES,
                "role": role,
            }
        logger.warning("Local auth failed for user: %s", username)
        return None

    # ── AD / LDAP auth ──
    ldap3 = _ldap3()

    server_url = _auth.ad_server
    domain     = _auth.ad_domain
    base_dn    = _auth.ad_base_dn
    search_filter = _auth.ad_user_search_filter.format(username=_sanitize_ldap(username))
    group_attr    = _auth.ad_group_attribute

    if not server_url:
        logger.error("AD auth is enabled but ad_server is not configured")
        return None

    # Effective timeouts — connect must be > 0 to avoid blocking forever
    _connect_timeout = _auth.ad_connect_timeout or 3
    _receive_timeout = getattr(_auth, "ad_receive_timeout", 10)

    server = _make_ldap_server(
        ldap3, server_url, _connect_timeout, _auth.ad_use_ssl, _auth.ad_tls_validate
    )

    # NTLM does not behave reliably over LDAPS in ldap3.
    # Use SIMPLE auth (with UPN format) over LDAPS; NTLM over plain LDAP/StartTLS.
    # Robust detection — strip whitespace + case-fold the URL scheme check so
    # typos like " ldaps://" or "LDAPS://" don't silently fall through to NTLM
    # (which crashes on OpenShift/FIPS via MD4).
    _server_url_norm = (server_url or "").strip().lower()
    _use_ssl = bool(_auth.ad_use_ssl) or _server_url_norm.startswith("ldaps://")
    logger.info(
        "AD bind decision: user=%s ad_server=%r ad_use_ssl=%r domain=%r "
        "normalized_url=%r → use_ssl=%s → auth_method=%s",
        username, server_url, _auth.ad_use_ssl, domain,
        _server_url_norm, _use_ssl, "SIMPLE" if _use_ssl else ("NTLM" if domain else "SIMPLE"),
    )
    if _use_ssl:
        auth_method = ldap3.SIMPLE
        # UPN format (user@domain) works better than NTLM for LDAPS SIMPLE bind
        bind_user = f"{username}@{domain}" if domain and "@" not in username else username
    else:
        auth_method = ldap3.NTLM if domain else ldap3.SIMPLE
        bind_user = f"{domain}\\{username}" if domain else username

    try:
        conn = ldap3.Connection(
            server,
            user=bind_user,
            password=password,
            authentication=auth_method,
            receive_timeout=_receive_timeout,
            auto_bind=True,
        )
    except _catch_ldap_connection_errors(ldap3) as e:
        logger.warning("AD bind failed for user %s (%s: %s)", username, type(e).__name__, e)
        return None

    # Search for the user to get display name, email, groups
    conn.search(
        search_base=base_dn,
        search_filter=search_filter,
        attributes=["displayName", "mail", group_attr],
    )

    if not conn.entries:
        conn.unbind()
        logger.warning("AD search returned no entries for: %s", username)
        return None

    entry = conn.entries[0]
    display_name = str(entry.displayName) if hasattr(entry, "displayName") else username
    email        = str(entry.mail)        if hasattr(entry, "mail")        else ""

    raw_groups: list = []
    if hasattr(entry, group_attr):
        raw_groups = list(getattr(entry, group_attr))

    # Extract CN from each group DN  e.g. "CN=Admins,DC=..." → "admins"
    groups = []
    for dn in raw_groups:
        cn = dn.split(",")[0].replace("CN=", "").replace("cn=", "").strip()
        groups.append(cn)

    role = _resolve_role(username, groups)

    conn.unbind()
    return {
        "username": username,
        "display_name": display_name,
        "email": email,
        "groups": groups,
        "is_admin": role in ADMIN_TIER_ROLES,
        "role": role,
    }


def authenticate_interactive(username: str, password: str) -> Optional[dict]:
    """Interactive UI login entry point — used ONLY by ``POST /auth/login``.

    Tries the normal auth backend first (none / local / AD). If that fails,
    falls back to the SQLite ``super_admins`` break-glass table so an operator
    can always recover access, even when AD is down.

    This function is **never** called by Basic-auth API requests — those go
    through :func:`authenticate_user` directly, which never touches the
    ``super_admins`` table. That way every API request avoids a DB lookup for
    break-glass credentials (simplify H1).

    Returns the same user-info dict as :func:`authenticate_user`, with
    ``role == "super_admin"`` and ``is_admin == True`` when break-glass wins.
    """
    user = authenticate_user(username, password)
    if user is not None:
        return user
    # Normal auth failed — try break-glass super_admin.
    return _try_super_admin_login(username, password, record_login=True)


def decode_basic_header(authorization: str) -> tuple[str, str]:
    """Parse 'Basic <base64(user:password)>' or 'Bearer <base64(user:password)>' header."""
    parts = authorization.split(" ", 1)
    if len(parts) != 2:
        raise ValueError("Invalid Authorization header format")
    encoded = parts[1]
    try:
        decoded = base64.b64decode(encoded).decode("utf-8")
    except Exception:
        raise ValueError("Could not base64-decode Authorization header")
    if ":" not in decoded:
        raise ValueError("Authorization payload must be user:password")
    user, pw = decoded.split(":", 1)
    return user, pw
