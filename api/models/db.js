const sqlite = require('sqlite');
const Promise = require('bluebird');
const dateFormat = require('dateformat');

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
        return sqlite.get("SELECT job_id, username, token, app_id, name, status, inputs, parameters, batch_queue, max_run_time, start_time, end_time, history FROM jobs WHERE job_id=?", jobId);
    }

    getJobs() {
        return sqlite.all("SELECT job_id, username, token, app_id, name, status, inputs, parameters, batch_queue, max_run_time, start_time, end_time, history FROM jobs");
    }

    getJobsForUser(username) {
        return sqlite.all("SELECT job_id, username, token, app_id, name, status, inputs, parameters, batch_queue, max_run_time, start_time, end_time, history FROM jobs WHERE username=?", username);
    }

    getActiveJobs() {
        return sqlite.all("SELECT job_id, username, token, app_id, name, status, inputs, parameters, batch_queue, max_run_time, start_time, end_time, history FROM jobs WHERE status NOT IN ('STOPPED', 'FINISHED', 'FAILED')");
    }

    addJob(job_id, username, token, app_id, name, status, inputs, parameters) {
        var start_time = getTimestamp();
        return sqlite.run(
            "INSERT INTO jobs (job_id, username, token, app_id, name, status, inputs, parameters, start_time) VALUES (?,?,?,?,?,?,?,?,?)",
            [job_id, username, token, app_id, name, status, inputs, parameters, start_time]
        );
    }

    updateJob(job_id, status, system_name, system_type, batch_queue, max_run_time, history, isEnded) {
        var end_time = ( isEnded ? getTimestamp() : null );
        return sqlite.run(
            "UPDATE jobs SET status=?, system_name=?, system_type=?, batch_queue=?, max_run_time=?, history=?, end_time=? WHERE job_id=?",
            [status, system_name, system_type, batch_queue, max_run_time, history, end_time, job_id]
        );
    }

    stopJobs() {
        return sqlite.run("UPDATE jobs SET status='STOPPED', token='' WHERE status NOT IN ('STOPPED', 'FINISHED', 'FAILED')");
    }
}

function getTimestamp() {
    var now = new Date();
    return dateFormat(now, "yyyy-mm-dd") + "T" + dateFormat(now, "HH:MM:ss.lo"); // dateFormat(now, "isoDateTime");
}

exports.Database = Database;
exports.getTimestamp = getTimestamp;