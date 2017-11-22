const sqlite = require('sqlite');
const Promise = require('bluebird');

class Database {
    constructor() {}

    open(sqliteFilePath) {
        if (!sqliteFilePath) {
            console.error('Missing sqliteFilePath argument');
            return;
        }

        return sqlite.open(sqliteFilePath, { Promise });
    }

    getJob(jobId) {
        return sqlite.get("SELECT job_id, app_id, name, status, inputs, parameters, start_time, end_time FROM jobs WHERE job_id=?", jobId);
    }

    getJobs() {
        return sqlite.all("SELECT job_id, app_id, name, status, inputs, parameters, start_time, end_time FROM jobs");
    }

    getActiveJobs() {
        return sqlite.all("SELECT job_id, app_id, name, status, inputs, parameters, start_time, end_time FROM jobs WHERE status NOT IN ('STOPPED', 'FINISHED', 'FAILED')");
    }

    addJob(job_id, app_id, name, status, inputs, parameters) {
        var timestamp = new Date().toLocaleString();
        return sqlite.run("INSERT INTO jobs (job_id, app_id, name, status, inputs, parameters, start_time) VALUES (?,?,?,?,?,?,?)", [job_id, app_id, name, status, inputs, parameters, timestamp]);
    }

    updateJob(job_id, status) {
        return sqlite.run("UPDATE jobs SET status=? WHERE job_id=?", [status, job_id]);
    }

    stopJobs() {
        return sqlite.run("UPDATE jobs SET status='STOPPED' WHERE status NOT IN ('STOPPED', 'FINISHED', 'FAILED')");
    }
}

exports.Database = Database;