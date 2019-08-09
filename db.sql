CREATE TABLE jobs (
    job_id     TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    token      TEXT,
    app_id     TEXT NOT NULL,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL,
    inputs     TEXT,
    parameters TEXT,
    start_time TEXT NOT NULL,
    end_time   TEXT
);
