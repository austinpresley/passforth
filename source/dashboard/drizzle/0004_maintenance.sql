CREATE TABLE maintenance_runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL, lease_until TEXT NOT NULL, result TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
CREATE INDEX maintenance_owner ON maintenance_runs(owner,updated_at);
