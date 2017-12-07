'use strict';

const job  = require('./models/job');
const cors = require('cors');
const bodyParser = require('body-parser');
const config = require('../config.json');


module.exports = function(app, jobManager) {
    app.use(cors());
    app.use(bodyParser.json()); // support json encoded bodies
    app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

    app.get('/apps/:id(\\S+)', function(request, response) {
        var id = request.params.id;
        console.log('GET /apps' + id);

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

    app.get('/jobs', async (request, response) => {
        console.log('GET /jobs');

        try {
            var jobs = await jobManager.getJob();
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
        }
        catch (err) {
            response.json({
                status: "error",
                message: err
            });
        }
    });

    app.get('/jobs/:id(\\S+)', async (request, response) => {
        var id = request.params.id;
        console.log('GET /jobs' + id);

        try {
            var job = await jobManager.getJob(id);
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
        }
        catch (err) {
            response.json({
                status: "error",
                message: err
            });
        }
    });

    app.post('/jobs', async (request, response) => {
        console.log("POST /jobs\n", request.body);

        try {
            var j = new job.Job(request.body);
            await jobManager.submitJob(j);

            response.json({
                status: "success",
                result: {
                    id: j.id
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
