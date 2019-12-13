'use strict';

const cluster = require('cluster');
const express = require('express');
const JobManager = require('./api/models/job').JobManager;

// Load config file
const config = require('./config.json');

// Spawn workers and start server
var app = express();
var jobManager = new JobManager({ isMaster: cluster.isMaster });
require('./api/routes.js')(app, jobManager);

var numWorkers = process.env.WORKERS || require('os').cpus().length;

if (cluster.isMaster) {
    console.log('Start cluster with %s workers', numWorkers);

    for (var i = 0; i < numWorkers; ++i) {
        var worker = cluster.fork().process;
        console.log('Worker %s started.', worker.pid);
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
    var server = app.listen(config.serverPort, function() {
        console.log('Process ' + process.pid + ' is listening to all incoming requests on port ' + config.serverPort);
    });
}

// Global uncaught exception handler
process.on('uncaughtException', function (err) {
    console.error((new Date).toUTCString() + ' uncaughtException:', err.message)
    console.error(err.stack)
    process.exit(1)
});