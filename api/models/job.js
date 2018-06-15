const dblib = require('../db.js');
const Promise = require('bluebird');
const spawn = require('child_process').spawnSync;
const execFile = require('child_process').execFile;
const pathlib = require('path');
const shortid = require('shortid');
const requestp = require('request-promise');
const config = require('../../config.json');

const STATUS = {
    CREATED:         "CREATED",         // Created/queued
    STAGING_INPUTS:  "STAGING_INPUTS",  // Transferring input files from IRODS to HDFS
    RUNNING:         "RUNNING",         // Running on Hadoop
    ARCHIVING:       "ARCHIVING",       // Transferring output files from HDFS to IRODS
    FINISHED:        "FINISHED",        // All steps finished successfully
    FAILED:          "FAILED",          // Non-zero return code from any step
    STOPPED:         "STOPPED"          // Cancelled due to server restart
}

const MAX_JOBS_RUNNING = 2;

class Job {
    constructor(props) {
        this.id = props.id || 'planb-' + shortid.generate();
        this.username = props.username; // CyVerse username of user running the job
        this.token = props.token;
        this.name = props.name;
        this.appId = props.appId;
        this.startTime = props.startTime;
        this.endTime = props.endTime;
        this.inputs = props.inputs || {};
        this.parameters = props.parameters || {};
        this.status = props.status || STATUS.CREATED;
        this.stagingPath = config.remoteStagingPath + '/' + this.id;
        this.targetPath = config.remoteTargetPath + '/' + this.id;
    }

    setStatus(newStatus) {
        if (this.status == newStatus)
            return;

        this.status = newStatus;

        // TODO
//        this.history.push({
//            created: dblib.getTimestamp(),
//            createdBy: this.username,
//            description: "",
//            status: newStatus
//        });
    }

    stageInputs() {
        var self = this;
        var staging_path = this.stagingPath + '/data/';
        var target_path = this.targetPath + '/data';

        // Copy data staging script to remote system
        remote_copy('./scripts/stage_data.sh');

        var stage_script = config.remoteStagingPath + '/stage_data.sh';
        var log_file = config.remoteStagingPath + '/libra.log';

        var promises = [];

        // Share output path with "imicrobe"
        promises.push(
            sharePath(self.token, '/' + this.username + '/' + config.archivePath, false)
        );

        if (this.inputs) {
            Object.values(this.inputs).forEach( path => { // In reality there will only be one input path for Libra
                console.log('Job ' + this.id + ': staging input: ' + path);

                if (path.startsWith('hsyn:///')) // file is already present via Syndicate mount // TODO find a way to indicate this in job definition
                    return;

                  var irodsPath = '/iplant/home' + path;
                  var runStagingScript = remote_command('sh ' + stage_script + ' ' + irodsPath + ' ' + this.id + ' ' + staging_path + ' ' + target_path + ' >> ' + log_file + ' 2>&1');

                  // Share input path with "imicrobe" (skip for /iplant/home/shared paths)
                  if (irodsPath.startsWith('/iplant/home/shared')) {
                      promises.push(
                          runStagingScript
                      );
                  }
                  else {
                      promises.push(
                          sharePath(self.token, path, true)
                              .then( () =>
                                  runStagingScript
                              )
                      );
                  }
            });
        }

        return Promise.all(promises);
    }

    runLibra() {
        //FIXME use defaults in app definition
        var KMER_SIZE = this.parameters.KMER_SIZE || 20;
        var FILTER_ALG = this.parameters.FILTER_ALG || "NOTUNIQUE";
        var NUM_TASKS = this.parameters.NUM_TASKS || 1;
        var RUN_MODE = this.parameters.RUN_MODE || "map";
        var WEIGHTING_ALG = this.parameters.WEIGHTING_ALG || "LOGALITHM";
        var SCORING_ALG = this.parameters.SCORING_ALG || "COSINESIMILARITY";

        var target_path = this.targetPath + '/data/';
        var input_path;
        if (this.inputs.IN_DIR.startsWith('hsyn:///')) // Syndicate mount
            input_path = this.inputs.IN_DIR;
        else // Staged data from Data Store
            input_path = target_path;// + pathlib.basename(this.inputs.IN_DIR);

        // Copy job execution script to remote system
        remote_copy('./scripts/run_libra.sh');

        var run_script = config.remoteStagingPath + '/run_libra.sh';
        var log_file = config.remoteStagingPath + '/libra.log';
        return remote_command('sh ' + run_script + ' ' + this.id + ' ' + input_path + ' ' + KMER_SIZE + ' ' + NUM_TASKS + ' ' + FILTER_ALG + ' ' + RUN_MODE + ' ' + WEIGHTING_ALG + ' ' + SCORING_ALG + ' >> ' + log_file + ' 2>&1');
    }

    archive() {
        var self = this;
        var archivePath = '/iplant/home/' + this.username + '/' + config.archivePath + '/' + 'job-' + this.id;
        return remote_command('iput -KTr ' + this.stagingPath + ' ' + archivePath)
            .then( () =>
                remote_command('ichmod -r own ' + this.username + ' ' + archivePath)
            );
    }
}

class JobManager {
    constructor(props) {
        this.isMaster = props.isMaster;
        this.UPDATE_INITIAL_DELAY = 5000; // milliseconds
        this.UPDATE_REFRESH_DELAY = 5000; // milliseconds

        this.init();
    }

    async init() {
        var self = this;

        console.log("JobManager.init");

        this.db = new dblib.Database();
        await this.db.open(config.dbFilePath);

        // Set pending jobs to cancelled
        if (this.isMaster) {
            console.log("Setting all jobs to STOPPED");
            await this.db.stopJobs();
        }

        // Start update loop
        if (this.isMaster) {
            console.log("Starting main update loop");
            setTimeout(() => {
                self.update();
            }, this.UPDATE_INITIAL_DELAY);
        }
    }

    async getJob(id, username) {
        var self = this;

        const job = await this.db.getJob(id);

        if (!job || (username && job.username != username))
            return;

        return self.createJob(job);
    }

    async getJobs(username) {
        var self = this;
        var jobs;

        if (username)
            jobs = await this.db.getJobsForUser(username);
        else
            jobs = await this.db.getJobs();

        return jobs.map( job => { return self.createJob(job) } );
    }

    async getActiveJobs() {
        var self = this;

        const jobs = await this.db.getActiveJobs();

        return jobs.map( job => { return self.createJob(job) } );
    }

    createJob(job) {
        return new Job({
            id: job.job_id,
            username: job.username,
            token: job.token,
            appId: job.app_id,
            name: job.name,
            status: job.status,
            inputs: JSON.parse(job.inputs),
            parameters: JSON.parse(job.parameters),
            startTime: job.start_time,
            endTime: job.end_time
        });
    }

    submitJob(job) {
        console.log("JobManager.submitJob", job.id);

        if (!job) {
            console.error("JobManager.submitJob: missing job");
            return;
        }

        return this.db.addJob(job.id, job.username, job.token, job.appId, job.name, job.status, JSON.stringify(job.inputs), JSON.stringify(job.parameters));
    }

    async transitionJob(job, newStatus) {
        console.log('Job.transition: job ' + job.id + ' from ' + job.status + ' to ' + newStatus);
        job.setStatus(newStatus);
        await this.db.updateJob(job.id, job.status, (newStatus == STATUS.FINISHED));
    }

    runJob(job) {
        var self = this;

        self.transitionJob(job, STATUS.STAGING_INPUTS)
        .then( () => { return remote_command('mkdir -p ' + config.remoteStagingPath) })
        .then( () => { return job.stageInputs() })
        .then( () => self.transitionJob(job, STATUS.RUNNING) )
        .then( () => { return job.runLibra() })
        .then( () => self.transitionJob(job, STATUS.ARCHIVING) )
        .then( () => { return job.archive() })
        .then( () => self.transitionJob(job, STATUS.FINISHED) )
        .catch( error => {
            console.log('runJob ERROR:', error);
            self.transitionJob(job, STATUS.FAILED);
        });
    }

    async update() {
        var self = this;

        //console.log("Update ...")
        var jobs = await self.getActiveJobs();
        if (jobs && jobs.length) {
            var numJobsRunning = jobs.reduce( (sum, value) => {
                if (value.status == STATUS.RUNNING)
                    return sum + 1
                else return sum;
            } );

            await jobs.forEach(
                async job => {
                    //console.log("update: job " + job.id + " is " + job.status);
                    if (numJobsRunning >= MAX_JOBS_RUNNING)
                        return;

                    if (job.status == STATUS.CREATED) {
                        console.log
                        self.runJob(job);
                        numJobsRunning++;
                    }
                }
            );
        }

        setTimeout(() => {
            self.update();
        }, this.UPDATE_REFRESH_DELAY);
    }
}

function remote_command(cmd_str) {
    var remoteCmdStr = 'ssh ' + config.remoteUsername + '@' + config.remoteHost + ' ' + cmd_str;
    console.log("Executing remote command: " + remoteCmdStr);

    return new Promise(function(resolve, reject) {
        const child = execFile(
            'ssh', [ config.remoteUsername + '@' + config.remoteHost, cmd_str ],
            { maxBuffer: 10 * 1024 * 1024 }, // 10mb -- was overrunning with default 200kb
            (error, stdout, stderr) => {
                console.log('remote_command:stdout:', stdout);
                console.log('remote_command:stderr:', stderr);

                if (error) {
                    console.error(error);
                    reject(error);
                }
                else {
                    resolve(stdout);
                }
            }
        );
    });
}

function remote_copy(local_file) {
    var cmdStr = 'scp ' + local_file + ' ' + config.remoteHost + ':' + config.remoteStagingPath;
    console.log("Copying to remote: " + cmdStr);

    const cmd = spawn('scp', [ local_file, config.remoteHost + ':' + config.remoteStagingPath ]);
    console.log( `stderr: ${cmd.stderr.toString()}` );
    console.log( `stdout: ${cmd.stdout.toString()}` );
}

function sharePath(token, path, recursive) {
    var url = config.agaveFilesUrl + "pems/system/data.iplantcollaborative.org" + path;
    var options = {
        method: "POST",
        uri: url,
        headers: {
            Accept: "application/json" ,
            Authorization: token
        },
        form: {
            username: "imicrobe",
            permission: "READ_WRITE",
            recursive: recursive
        },
        json: true
    };

    return getPermissions(token, path)
          .then( permission => {
              if (permission == "NONE") {
                  console.log("Sending POST", url);
                  return requestp(options);
              }
              else
                  return new Promise((resolve) => { resolve(); });
          });
//      .catch(function (err) {
//          console.error(err.message);
//          res.status(500).send("Agave permissions request failed");
//      });
}

function getPermissions(token, path) {
    var url = config.agaveFilesUrl + "pems/system/data.iplantcollaborative.org" + path;
    var options = {
        method: "GET",
        uri: url,
        headers: {
            Accept: "application/json" ,
            Authorization: token
        },
        form: {
            username: "imicrobe",
            recursive: false
        },
        json: true
    };

    console.log("Sending GET", url);
    return requestp(options)
        .then(response => {
            if (response && response.result) {
                var user = response.result.find(user => user.username == "imicrobe");
                if (user && user.permission) {
                    if (user.permission.write)
                        return "READ_WRITE";
                    if (user.permission.read)
                        return "READ";
                }
            }

            return "NONE";
        });
//      .catch(function (err) {
//          console.error(err.message);
//          res.status(500).send("Agave permissions request failed");
//      });
}

//function remote_get_file(token, src_path, dest_path) {
//    return remote_command('curl -sk -H "Authorization: ' + escape(token) + '" -o ' + dest_path + ' ' + config.agaveFilesUrl + 'media' + src_path);
//}
//
//function remote_get_directory(token, src_path, dest_path) {
//    return remote_command('curl -sk -H "Authorization: ' + escape(token) + '" ' + config.agaveFilesUrl + 'listings/' + src_path)
//        .then(data => {
//            var response = JSON.parse(data);
//            return response.result;
//        })
//        .each(file => { // transfer one file at a time to avoid "ssh_exchange_identification" error
//            if (file.name != '.') {
//                return remote_get_file(token, file.path, dest_path + '/' + file.name)
//                    .then(() => {
//                        // TODO: move gzip to bzip2 conversion to run_libra.sh ...?
//                        if (file.name.endsWith('.gz') || file.name.endsWith('.gzip')) {
//                            return remote_gzip_to_bzip2(dest_path + '/' + file.name);
//                        }
//                    });
//            }
//        });
//}
//
//function remote_gzip_to_bzip2(src_path) {
//    var path = pathlib.parse(src_path);
//    var dest_path = path.dir + '/' + path.name + '.bz2';
//    return remote_command('gunzip --stdout ' + src_path + ' | bzip2 > ' + dest_path + ' && rm ' + src_path);
//}
//
//function remote_put_file(token, src_path, dest_path) {
//    return remote_command('curl -sk -H "Authorization: ' + escape(token) + '" -X POST -F "fileToUpload=@' + src_path + '" ' + config.agaveFilesUrl + 'media/' + dest_path)
//}
//
//function remote_put_directory(token, src_path, dest_path) {
//    return remote_make_directory(token, dest_path)
//        .then( () => { return remote_command('ls -d -1 ' + src_path + '/*.*') } )
//        .then( ls => {
//            return ls.split("\n");
//        })
//        .each(file => { // transfer one file at a time to avoid "ssh_exchange_identification" error
//            if (file) {
//                return remote_put_file(token, file, dest_path);
//            }
//        });
//}
//
//function remote_make_directory(token, dest_path) {
//    var path = pathlib.parse(dest_path);
//    return remote_command('curl -sk -H "Authorization: ' + escape(token) + '" -X PUT -d "action=mkdir&path=' + path.base + '" ' + config.agaveFilesUrl + 'media/' + path.dir);
//}

function escape(str) {
    str.replace(/\\/g, "\\\\")
       .replace(/\$/g, "\\$")
       .replace(/'/g, "\\'")
       .replace(/"/g, "\\\"");
    return str;
}

exports.Job = Job;
exports.JobManager = JobManager;
