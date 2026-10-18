"""Local setup metadata. Credentials are deliberately outside this format."""
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit


def write_json(path, value, private=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    temporary = path.with_name(path.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
    os.replace(temporary, path)


def profile_at(path, complete=True):
    profile = json.loads(Path(path).read_text())
    allowed = {"schema_version", "site_project_id", "site_url", "plugin_id", "agent_id", "timezone", "new_paid_resources_authorized"}
    if set(profile) - allowed or profile.get("schema_version") != 1:
        raise ValueError("Use profile.example.json. Keep credentials in a separate private file.")
    if profile.get("agent_id") != "dot":
        raise ValueError("This kit uses the inbox label 'dot'. It is not a person's Dot identifier.")
    from zoneinfo import ZoneInfo
    ZoneInfo(profile.get("timezone", ""))
    url = profile.get("site_url")
    if not complete and not url:
        return profile
    parsed = urlsplit(url or "")
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise ValueError("site_url must be the provider-returned HTTPS origin, without credentials, query or path.")
    if parsed.hostname in ("localhost", "127.0.0.1") or parsed.hostname.endswith(".invalid"):
        raise ValueError("Use the real recipient-owned Site URL.")
    if not isinstance(profile.get("site_project_id"), str) or not profile["site_project_id"].strip():
        raise ValueError("Copy the real project ID from the provider response.")
    profile["site_url"] = "https://" + parsed.hostname
    return profile


def bundle_id(profile):
    return "com.apresley.dotdesk.menubar"


def cache_namespace(profile):
    return "site-" + hashlib.sha256(profile["site_project_id"].encode()).hexdigest()


def source_fingerprint(root):
    """Hash source only, never local state, dependencies, credentials or builds."""
    digest = hashlib.sha256()
    ignored = {"node_modules", ".git", ".wrangler", "dist", ".next", "build", ".cache", "__pycache__", ".sites-runtime"}
    root = Path(root)
    paths = []
    for directory, folders, files in os.walk(root):
        relative = Path(directory).relative_to(root)
        folders[:] = [name for name in folders if name not in ignored or (relative == Path("dashboard") and name == "build")]
        for name in files:
            paths.append(Path(directory) / name)
    for path in sorted(paths):
        rel = path.relative_to(root)
        if path.name in ("next-env.d.ts", ".DS_Store") or path.is_symlink() or any(part.startswith(".env") for part in rel.parts) or rel.parts[:3] == ("dashboard", ".openai", "local") or path.name.endswith((".sqlite", ".sqlite3", ".db", ".tsbuildinfo")):
            continue
        digest.update(str(rel).encode() + b"\0" + hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()
