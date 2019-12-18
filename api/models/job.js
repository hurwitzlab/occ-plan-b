const os = require("os");
const Promise = require('bluebird');
const { spawn, exec, execFile, execFileSync } = require('child_process');
const process = require('process');
const { dirname, basename, extname, parse } = require('path');
const shortid = require('shortid');

const { Database, getTimestamp } = require('./db.js');
const config = require('../../config.json'); // FIXME pass config params into JobManager constructor

const STATUS = {
    CREATED:         "CREATED",         // Created/queued
    STAGING_INPUTS:  "STAGING_INPUTS",  // Transferring input files from data store to target system
    SUBMITTING:      "SUBMITTING",      // Submitting to target system
    RUNNING:         "RUNNING",         // Running on target system
    ARCHIVING:       "ARCHIVING",       // Transferring output files from target system to data store
    FINISHED:        "FINISHED",        // All steps finished successfully
    FAILED:          "FAILED",          // Non-zero return code from any step
    STOPPED:         "STOPPED"          // Cancelled due to server restart
}

const MAX_JOBS_RUNNING = config.maxNumRunningJobs || 4;

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
        this.history = props.history || [];

        this.app = props.app;
        if (this.app) {
            this.batchQueue = props.batchQueue || this.app.defaultQueue;
            this.maxRunTime = props.maxRunTime || this.app.defaultMaxRunTime;
            this.nodeCount = props.nodeCount || this.app.defaultNodeCount;
            this.processorsPerNode = props.processorsPerNode || this.app.defaultProcessorsPerNode;
            this.memoryPerNode = props.memoryPerNode || this.app.defaultMemoryPerNode;
        }

        this.system = props.system;
        if (this.system) {
            this.stagingPath = this.system.stagingPath + '/' + this.id;
            this.mainLogFile = this.system.stagingPath + '/jobs.log';
            this.jobLogFile = this.stagingPath + '/data/job.log';
            if (this.system.type == "hadoop")
                this.targetPath = this.system.targetHdfsPath + '/' + this.id;
        }
    }

    setStatus(newStatus) {
        if (this.status == newStatus)
            return;

        this.status = newStatus;
        this.pushHistory("Transition to " + newStatus);
    }

    pushHistory(description) {
        console.log("pushHistory:", description);

        this.history.push({
            created: getTimestamp(),
            createdBy: this.username,
            description: description,
            status: this.status
        });
    }

    async stageInputs() {
        var self = this;
        var dataStagingPath = this.stagingPath + '/data/';

        // Make sure staging area exists
        await this.system.execute(['mkdir -p', dataStagingPath]);

        // Print IRODS user info for debug
        //await this.system.execute(['iuserinfo']);

        // Download app to staging area
        await this.system.execute(['iget -Tr', this.app.deploymentPath, this.stagingPath]);

        // Share output path with our IRODS user
        var homePath = '/' + this.username
        await agave_sharePath(self.token, homePath, "READ", false); // Need to share home path for sharing within home path to work
        var archivePath = homePath + '/' + config.archivePath
        await agave_mkdir(self.token, archivePath); // Create archive path in case it doesn't exist yet (new user)
        await agave_sharePath(self.token, archivePath, "READ_WRITE", false);

        // Create log file
        await this.system.execute(['mkdir -p', this.stagingPath]);
        await this.system.execute(['touch', this.jobLogFile]);

        if (this.inputs) {
            // Collapse and trim input paths
            let inputs = Object.values(this.inputs)
                .reduce((acc, val) => acc.concat(val), [])
                .filter(path => path)
                .map(path => path.trim());
            console.log('inputs:', inputs);

            // First share the input paths with our IRODS user
            for (let path of inputs) {
                if (!path.startsWith('/shared')) { // Skip for paths in /iplant/home/shared
                    await agave_sharePath(self.token, path, "READ", true);
                    if (extname(path)) // If this is an input file then share parent directory too
                        await agave_sharePath(self.token, dirname(path), "READ", false);
                }
            }

            // Transfer input files
            for (let path of inputs) {
                this.pushHistory('Transferring ' + path);
                var irodsPath = (path.startsWith('/iplant/home') ? path : '/iplant/home' + path);
                var targetPath = dataStagingPath + basename(path);
                await this.system.execute(['iget -Tr', irodsPath, targetPath]); // works for file or directory
            }
        }
    }

    async run() {
        var dataStagingPath = this.stagingPath + '/data/';

        let params = [];

        // Construct parameter arguments
        for (let id in this.parameters) {
            let param = this.app.parameters.filter(param => param.id == id)[0];
            let arg = param.details.argument;
            let val = this.parameters[id];

            if (val == "") 
                val = param.value.default;

            if (Array.isArray(val))
                val = val.join(' ');
 
            if (val == "")
                continue; // skip parameter if blank

            if (param.value.type == "flag") {
                if (val === true)
                    params.push(arg);
            }
            else {
                if (param.value.enquote)
                    val = '"' + val + '"';

                params.push(arg + ' ' + val);
            }
        }

        // Construct input arguments
        for (let id in this.inputs) {
            let val = this.inputs[id];

            if (Array.isArray(val))
                val = val.filter(path => path)
                    .map(path => dataStagingPath + basename(path))
                    .join(' ');
            else
                val = dataStagingPath + basename(val);

            if (!val)
                continue; // skip input if blank

            let arg = this.app.inputs.filter(inp => inp.id == id)[0].details.argument || "";
            params.push(arg + ' ' + val);
        }

        let subdir = this.app.deploymentPath.match(/([^\/]*)\/*$/)[1]; //*/
        let runScript = this.stagingPath + '/' + subdir + '/run.sh';

        if (this.system.type == 'hpc')
            //await this.system.execute(['qsub', '-v', "PLANB_JOBPATH=" + this.stagingPath + ",CMDARGS=\'" + params.join(' ') + "\'", runScript ]);
            await this.system.execute([
                'sbatch',
                '-J', this.id,
                '-A', 'iPlant-Collabs', //FIXME hardcoded
                '-o', this.jobLogFile,
                '-e', this.jobLogFile,
                '-N', this.nodeCount || 1,
                '-n', this.processorsPerNode || 1,
                //'--mem=' + this.app.defaultMemoryPerNode || 96, // Stampede2 User Guide: "Not available. If you attempt to use this option, the scheduler will not accept your job."
                '-t', this.maxRunTime || "24:00:00",
                '-p', this.batchQueue || 'normal',
                '--export=PLANB_JOBPATH=' + this.stagingPath,
                runScript,
                params.map(escape).join(' ')
            ]);
        else
            await this.system.execute(['bash', runScript, params.join(' '), ' 2>&1 | tee -a ', this.mainLogFile, this.jobLogFile]);
    }

    async poll() {
        let finished = false;
        while (!finished) { //TODO add timeout here
            let out = await this.system.execute(['squeue', '-h', '-r', '-o', '%j', '--name', this.id]);
            finished = (out.indexOf(this.id) < 0);
            console.log("Finished:", this.id, finished);
            await sleep(10*1000); // 10 second delay
        }
    }

    async archive() {
        var self = this;
        var dataStagingPath = this.stagingPath + '/data/';

        var archivePath = '/iplant/home/' + this.username + '/' + config.archivePath + '/' + 'job-' + this.id;
        await this.system.execute(['iput -Tr', dataStagingPath, archivePath]); // removed "-K checksum" because hanging on node0
        await this.system.execute(['ichmod -r own', this.username, archivePath]);
    }
}

class JobManager {
    constructor(props) {
        this.isMaster = props.isMaster;
        this.UPDATE_INITIAL_DELAY = 5000; // milliseconds
        this.UPDATE_REFRESH_DELAY = 5000; // milliseconds

        this.apps = props.apps;
        this.systems = {};
        props.systems.forEach(system => this.systems[system.hostname] = new ExecutionSystem(system));

        this.init();
    }

    async init() {
        var self = this;

        console.log("JobManager.init");

        this.db = new Database();
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

        if (!job || (username && job.username != username && username != config.irodsUsername))
            return;

        return self.createJob(job);
    }

    async getJobs(username) {
        var self = this;
        var jobs;

        if (!username || username == config.irodsUsername) // let admin user see all jobs for all users
            jobs = await this.db.getJobs();
        else
            jobs = await this.db.getJobsForUser(username);

        return jobs.map( job => { return self.createJob(job) } );
    }

    async getActiveJobs() {
        var self = this;

        const jobs = await this.db.getActiveJobs();

        return jobs.map( job => self.createJob(job) );
    }

    createJob(job) {
        let app = this.apps[job.app_id];
        if (!app) {
            console.log('Error: missing app', job.app_id);
            return;
        }

        let system = this.systems[app.executionSystem];
        if (!system) {
            console.log('Error: missing system', app.executionSystem);
            return;
        }

        return new Job({
            id: job.job_id,
            username: job.username,
            token: job.token,
            appId: job.app_id,
            name: job.name,
            status: job.status,
            inputs: JSON.parse(job.inputs),
            parameters: JSON.parse(job.parameters),
            batchQueue: job.batch_queue,
            maxRunTime: job.max_run_time,
            nodeCount: job.node_count,
            processorsPerNode: job.processors_per_node,
            memoryPerNode: job.memory_per_node,
            startTime: job.start_time,
            endTime: job.end_time,
            history: JSON.parse(job.history),
            app: app,
            system: system
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
        await this.db.updateJob(
            job.id, job.status, job.system.hostname, job.system.type,
            job.batchQueue, job.maxRunTime, job.nodeCount, job.processorsPerNode, job.memoryPerNode,
            JSON.stringify(job.history),
            (newStatus == STATUS.FINISHED)
        );
    }

    async runJob(job) {
        var self = this;

        try {
            self.transitionJob(job, STATUS.STAGING_INPUTS);
            await job.stageInputs();

            if (job.system.type === 'hpc') {
                self.transitionJob(job, STATUS.SUBMITTING);
                await job.run();

                self.transitionJob(job, STATUS.RUNNING);
                await job.poll();
            }
            else {
                self.transitionJob(job, STATUS.RUNNING);
                await job.run();
            }

            self.transitionJob(job, STATUS.ARCHIVING);
            await job.archive();

            self.transitionJob(job, STATUS.FINISHED);
        }
        catch (error) {
            console.log('runJob ERROR:', error);
            self.transitionJob(job, STATUS.FAILED);
        }
    }

    async update() {
        var self = this;

        //console.log("Update ...")
        var jobs = await self.getActiveJobs();
        if (jobs && jobs.length) {
            var numJobsRunning = jobs.reduce( (sum, value) => {
                if (value.status == STATUS.STAGING_INPUTS || value.status == STATUS.RUNNING)
                    return sum + 1
                else return sum;
            }, 0 );

            jobs.forEach(
                job => {
//                    console.log("update: job " + job.id + " is " + job.status + " numRunning=" + numJobsRunning);
                    if (numJobsRunning < MAX_JOBS_RUNNING && job.status == STATUS.CREATED) {
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

class ExecutionSystem {
    constructor(props) {
        this.type = props.type;
        this.hostname = props.hostname;
        this.username = props.username;
        this.ssh = props.ssh;
        this.env = props.env || {};
        this.stagingPath = props.stagingPath;
        this.targetHdfsPath = props.targetHdfsPath;
        //this.hadoopJavaOpts = props.hadoopJavaOpts; //FIXME

        //TODO check for required props
    }

    execute(strOrArray) {
        let cmdStr = Array.isArray(strOrArray) ? strOrArray.join(' ') : strOrArray;
        let envStr = Object.keys(this.env).map(key => key + "=" + this.env[key]).join(' ');

        let isLocal = (os.hostname() == this.hostname);
        let sh, args = [];
        if (isLocal) { // local execution
            sh = "sh";
            args = [ '-c', '"' + envStr + cmdStr + '"' ];
        }
        else { // remote execution
            if (this.ssh) { // user defined ssh args
                let sshParts = this.ssh.split(' ');
                sh = sshParts.shift();
                args = sshParts.concat([envStr, cmdStr]);
            }
            else { // default ssh args
                sh = "ssh";
                args = [ this.username + '@' + this.hostname, envStr, cmdStr ];
            }
        }

        return new Promise(function(resolve, reject) {
            console.log("Remote command:", sh, args.join(' '));
            execFile( // use execFile(), not exec(), to prevent command injection
                sh, args,
                {
                    maxBuffer: 10 * 1024 * 1024, // 10M -- was overrunning with default 200K
                    shell: isLocal
                },
                (error, stdout, stderr) => {
                    console.log('execute:stdout:', stdout);
                    console.log('execute:stderr:', stderr);

                    if (error) {
                        console.log('execute:error:', error);
                        reject(error);
                    }
                    else {
                        resolve(stdout);
                    }
                }
            );
        });
    }
}

function local_command(strOrArray) {
    let cmdStr = strOrArray;
    if (Array.isArray(strOrArray))
        cmdStr = strOrArray.join(' ');

    console.log("Local command: " + cmdStr);

    return new Promise(function(resolve, reject) {
        const child = exec(
            cmdStr,
            (error, stdout, stderr) => {
                console.log('local_command:stdout:', stdout);
                console.log('local_command:stderr:', stderr);

                if (error) {
                    console.log('local_command:error:', error);
                    reject(error);
                }
                else {
                    resolve(stdout);
                }
            }
        );
    });
}

function agave_sharePath(token, path, permission, recursive) {
    var url = config.agaveFilesUrl + "pems/system/data.iplantcollaborative.org" + path;
    return local_command('curl -sk -H "Authorization: ' + escape(token) + '" -X POST -d "username=' + config.irodsUsername + '&permission=' + permission + '&recursive=' + recursive + '" ' + '"' + url + '"');
}

function agave_mkdir(token, destPath) {
    console.log("Creating remote directory", destPath);
    var path = parse(destPath);
    return local_command('curl -sk -H "Authorization: ' + escape(token) + '" -X PUT -d "action=mkdir&path=' + path.base + '" ' + config.agaveFilesUrl + 'media/' + path.dir);
}

function escape(s) {
    return s.replace(/(["\s'$`\\])/g, '\\$1');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

exports.Job = Job;
exports.JobManager = JobManager;
