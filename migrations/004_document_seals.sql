-- Owner-specific application signing keys. Included in ordinary PostgreSQL backups.
-- No alteration or re-signing of historic snapshots; no financial data is changed.
CREATE TABLE document_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    private_key BYTEA NOT NULL CHECK (octet_length(private_key) = 32),
    public_key BYTEA NOT NULL CHECK (octet_length(public_key) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
