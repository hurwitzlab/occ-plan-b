const dblib = require('../db.js');
const spawn = require('child_process').spawnSync;
const pathlib = require('path');
const shortid = require('shortid');
const config = require('../../config.json');

const db = new dblib.Database(config.dbFilePath);

const STATUS = {
    CREATED:         "CREATED",
    STAGING_INPUTS:  "STAGING_INPUTS",
    RUNNING:         "RUNNING",
    PUSHING_OUTPUTS: "PUSHING_OUTPUTS",
    FINISHED:        "FINISHED",
    FAILED:          "FAILED"
}

class Job {
    constructor(props) {
        this.id = props.id || 'planb-' + shortid.generate();
        this.name = props.name;
        this.appId = props.appId;
        this.startTime = props.startTime;
        this.endTime = props.endTime;
        this.inputs = props.inputs;
        this.parameters = props.parameters;
        this.status = props.status || STATUS.CREATED;
    }

    transition(newStatus) {
        console.log('Job.transition: job ' + this.id + ' to ' + newStatus);
        this.status = newStatus;
    }

    stageInputs() {
        if (!this.inputs)
            return;

        console.log('Job.stageInputs: ', this.inputs);

        var staging_path = config.remoteStagingPath + '/' + this.id + '/data/';
        var target_path = config.remoteTargetPath + '/' + this.id + '/data/';

        remote_command('mkdir -p ' + staging_path);

        remote_command('hdfs dfs -mkdir -p ' + target_path);

        Object.values(this.inputs).forEach( path => {
            console.log('Job ' + this.id + ': staging input: ' + path);
            path = '/iplant/home' + path;
            var base = pathlib.basename(path);
            remote_command(
                'cd ' + staging_path + ' && iget -frTK ' + path
            );
            remote_command(
                'cd ' + staging_path + ' && hdfs dfs -put ' + base + ' ' + target_path + base
            );
        });
    }

    run() {
        console.log('Job.run ', this.id);

        var KMER_SIZE = this.parameters.KMER_SIZE || 20;
        var FILTER_ALG = this.parameters.FILTER_ALG || "NOTUNIQUE";
        var NUM_TASKS = this.parameters.NUM_TASKS || 1;
        var RUN_MODE = this.parameters.RUN_MODE || "map";
        var WEIGHTING_ALG = this.parameters.WEIGHTING_ALG || "LOGALITHM";

        var target_path = config.remoteTargetPath + '/' + this.id + '/data/';
        var input_path = target_path + pathlib.basename(this.inputs.IN_DIR);
        var run_script = config.remoteStagingPath + '/run_libra.sh';

        // Copy job execution script to remote system
        remote_copy('./run_libra.sh');

        // FIXME is 'nohup' necessary?  And '&' isn't working
        remote_command('nohup sh ' + run_script + ' ' + this.id + ' ' + input_path + ' ' + KMER_SIZE + ' ' + NUM_TASKS + ' ' + FILTER_ALG + ' ' + RUN_MODE + ' ' + WEIGHTING_ALG + ' &');
    }

    pushOutputs() {
        console.log('Job.pushOutputs ', this.id);

        var staging_path = config.remoteStagingPath + '/' + this.id;
        var ds_output_path = '/iplant/home/' + config.remoteUsername + '/analyses/' + 'occ-' + this.id

        remote_command('iput -KTr ' + staging_path + '/score' + ' ' + ds_output_path);
    }
}

class JobManager {
    constructor(props) {
        this.jobs = {};
        this.UPDATE_INITIAL_DELAY = 5000; // milliseconds
        this.UPDATE_REFRESH_DELAY = 1000; // milliseconds

        this.init();
    }

    init() {
        var self = this;

        console.log("JobManager.init");

        // Start update loop
        setTimeout(() => {
            self.update();
        }, this.UPDATE_INITIAL_DELAY);
    }

    async get(id) {
        console.log("JobManager.get ", (id ? id : ""));

        if (typeof id == 'undefined') {
            const jobs = await db.getJobs()
            return jobs.map(
                job => {
                    return new Job({
                        id: job.job_id,
                        appId: job.app_id,
                        name: job.name,
                        status: job.status,
                        startTime: job.start_time,
                        endTime: job.end_time
                    });
                }
            );
        }
        else {
            const j = await db.getJob(id);
            console.log(j);
            return new Job({
                id: j.job_id,
                appId: j.app_id,
                name: j.name,
                status: j.status,
                startTime: j.start_time,
                endTime: j.end_time
            });
        }
    }

    submit(job) {
        console.log("JobManager.submit ", job);

        if (!job) {
            console.error("JobManager.submit: missing job");
            return;
        }

        return db.addJob(job.id, job.appId, job.name, job.status);
    }

    update() {
        var self = this;

        //console.log("Update ...")
        Object.values(this.jobs).forEach(
            job => {
                if (job.status == STATUS.CREATED) {
                    job.transition(STATUS.STAGING_INPUTS);
                    job.stageInputs();
                }
                else if (job.status == STATUS.STAGING_INPUTS) {
                    job.transition(STATUS.RUNNING);
                    job.run();
                }
                else if (job.status == STATUS.RUNNING) {
                    job.transition(STATUS.PUSHING_OUTPUTS);
                    job.pushOutputs();
                }
                else if (job.status == STATUS.PUSHING_OUTPUTS) {
                    job.transition(STATUS.FINISHED)
                }
            }
        );

        setTimeout(() => {
            self.update();
        }, this.UPDATE_REFRESH_DELAY);
    }
}

function remote_command(cmd_str) {
    var remoteCmdStr = 'ssh ' + config.remoteUsername + '@' + config.remoteHost + ' ' + cmd_str;
    console.log("Executing remote command: " + remoteCmdStr);

    const cmd = spawn('ssh', [ config.remoteUsername + '@' + config.remoteHost, cmd_str ]);
    console.log( `stderr: ${cmd.stderr.toString()}` );
    console.log( `stdout: ${cmd.stdout.toString()}` );

    return {
        stderr: cmd.stderr.toString(),
        stdout: cmd.stdout.toString()
    }
}

function remote_copy(local_file) {
    var cmdStr = 'scp ' + local_file + ' ' + config.remoteHost + ':' + config.remoteStagingPath;
    console.log("Copying to remote: " + cmdStr);

    const cmd = spawn('scp', [ local_file, config.remoteHost + ':' + config.remoteStagingPath ]);
    console.log( `stderr: ${cmd.stderr.toString()}` );
    console.log( `stdout: ${cmd.stdout.toString()}` );
}

exports.Job = Job;
exports.JobManager = JobManager;
