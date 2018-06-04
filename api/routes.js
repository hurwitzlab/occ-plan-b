'use strict';

const job  = require('./models/job');
const cors = require('cors');
const bodyParser = require('body-parser');
const https = require("https");
const config = require('../config.json');


module.exports = function(app, jobManager) {
    app.use(cors());
    app.use(bodyParser.json()); // support json encoded bodies
    app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

    app.get('/apps/:id(\\S+)', function(request, response) {
        var id = request.params.id;
        console.log('GET /apps/' + id);

        var apps = config.apps;
        if (typeof apps[id] === 'undefined') {
            response.json({
                status: "failure",
                message: "App " + id + " not found"
            });
            return;
        }

        response.json({
            status: "success",
            result: apps[id]
        });
    });

    app.get('/jobs', (request, response) => {
        console.log('GET /jobs');

        try {
            validateAgaveToken(request)
            .then( async profile => {
                var jobs = await jobManager.getJobs(profile.username);
                if (jobs) {
                    jobs = jobs.map( j => { j.inputs = arrayify(j.inputs); return j; } );
                    response.json({
                        status: "success",
                        result: jobs
                    });
                }
                else {
                    response.json({
                        status: "success",
                        result: []
                    });
                }
            });
        }
        catch (err) {
            response.json({
                status: "error",
                message: err
            });
        }
    });

    app.get('/jobs/:id(\\S+)', (request, response) => {
        var id = request.params.id;
        console.log('GET /jobs/' + id);

        try {
            validateAgaveToken(request)
            .then( async profile => {
                var job = await jobManager.getJob(id, profile.username);
                if (!job) {
                    response.json({
                        status: "error",
                        message: "Job " + id + " not found"
                    });
                    return;
                }

                job.inputs = arrayify(job.inputs);
                response.json({
                    status: "success",
                    result: job
                });
            });
        }
        catch (err) {
            response.json({
                status: "error",
                message: err
            });
        }
    });

    app.get('/jobs/:id(\\S+)/history', (request, response) => {
        var id = request.params.id;
        console.log('GET /jobs/' + id + '/history');

        try {
            validateAgaveToken(request)
            .then( async profile => {
                var job = await jobManager.getJob(id, profile.username);
                if (!job) {
                    response.json({
                        status: "error",
                        message: "Job " + id + " not found"
                    });
                    return;
                }

                //var history = arrayify(job.history); // TODO
                response.json({
                    status: "success",
                    result: []
                });
            });
        }
        catch (err) {
            response.json({
                status: "error",
                message: err
            });
        }
    });

    app.post('/jobs', (request, response) => {
        console.log("POST /jobs\n", request.body);

        try {
            validateAgaveToken(request)
            .then( async profile => {
                var j = new job.Job(request.body);
                j.username = profile.username;
                j.token = profile.token;
                await jobManager.submitJob(j);

                response.json({
                    status: "success",
                    result: {
                        id: j.id
                    }
                });
            });
        }
        catch (err) {
            response.json({
                status: "error",
                message: err
            });
        }
    });
}

function validateAgaveToken(request) {
    return new Promise((resolve, reject) => {
        var token;
        if (!request.headers || !request.headers.authorization) {
            reject(new Error('Authorization token missing'));
        }
        token = request.headers.authorization;
        console.log("token:", token);

        const profileRequest = https.request(
            {   method: 'GET',
                host: 'agave.iplantc.org',
                port: 443,
                path: '/profiles/v2/me',
                headers: {
                    Authorization: token
                }
            },
            response => {
                response.setEncoding("utf8");
                if (response.statusCode < 200 || response.statusCode > 299) {
                    reject(new Error('Failed to load page, status code: ' + response.statusCode));
                }

                var body = [];
                response.on('data', (chunk) => body.push(chunk));
                response.on('end', () => {
                    body = body.join('');
                    var data = JSON.parse(body);
                    if (!data || data.status != "success")
                        reject(new Error('Status ' + data.status));
                    else {
                        data.result.token = token;
                        resolve(data.result);
                    }
                });
            }
        );
        profileRequest.on('error', (err) => reject(err));
        profileRequest.end();
    });
}

function arrayify(obj) {
    var newObj = {};
    Object.keys(obj).forEach(prop => {
        if (Array.isArray(obj))
            newObj[prop] = obj[prop];
        else
            newObj[prop] = [ obj[prop] ];
    });
    return newObj;
}
