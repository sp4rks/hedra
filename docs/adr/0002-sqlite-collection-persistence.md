# Persist collections with Bun's SQLite driver

Collections use SQLite through Bun's built-in driver and retain their records across application restarts. This fits Hedra's single-process container runtime without adding a database service or dependency. Hedra owns one database shared by its registered collections; `HEDRA_SQLITE_PATH` selects its file and defaults to `.runtime/hedra.sqlite`. Container deployments persist the database directory through a volume to retain collection data.
