'use strict';

const fs = require("fs");
const { basename, extname } = require('path');
const cluster = require('cluster');
const express = require('express');
const JobManager = require('./api/models/job').JobManager;

// Load config file
const config = require('./config.json');

// Load apps and systems
const apps = {};
fs
    .readdirSync(config.apps)
    .filter(file =>
        extname(file) === '.json'
    )
    .forEach(file => {
        let data = fs.readFileSync(config.apps + '/' + file);
        let app = JSON.parse(data);
        let appId = basename(file, '.json');
        apps[appId] = app;
    });

const systems = require(config.systems);

const jobManager = new JobManager({
    isMaster: cluster.isMaster,
    apps: apps,
    systems: systems
});

// Spawn workers and start server
const app = express();
require('./api/routes.js')(app, apps, jobManager);

const numWorkers = process.env.WORKERS || require('os').cpus().length;

if (cluster.isMaster) {
    console.log('Start cluster with %s workers', numWorkers);

    for (let i = 0; i < numWorkers; ++i) {
        const worker = cluster.fork().process;
        console.log('Worker %s started', worker.pid);
    }

    cluster.on('online', function(worker) {
        console.log('Worker ' + worker.process.pid + ' is online');
    });

    cluster.on('exit', function(worker) {
        console.log('Worker %s died. restarting...', worker.process.pid);
        cluster.fork();
    });
}
else {
    const server = app.listen(config.serverPort, function() {
        console.log('Process ' + process.pid + ' is listening to all incoming requests on port ' + config.serverPort);
    });
}

// Global uncaught exception handler
process.on('uncaughtException', function (err) {
    console.error((new Date).toUTCString() + ' uncaughtException:', err.message)
    console.error(err.stack)
    process.exit(1)
});