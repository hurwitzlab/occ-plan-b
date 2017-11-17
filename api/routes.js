'use strict';

const job  = require('./models/job');
const cors = require('cors');
const bodyParser = require('body-parser');
const config = require('../config.json');


// Initialize job queue
//var jobManager = new job.JobManager();

module.exports = function(app, jobManager) {
    app.use(cors());
    app.use(bodyParser.json()); // support json encoded bodies
    app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

    app.get('/apps/v2/:id(\\S+)', function(request, response) {
        var id = request.params.id;
        console.log('GET /apps/v2/' + id);

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

    app.get('/jobs/v2', async (request, response) => {
        console.log('GET /jobs/v2');

        try {
            var jobs = await jobManager.get();
            if (jobs) {
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

    app.get('/jobs/v2/:id(\\S+)', async (request, response) => {
        var id = request.params.id;
        console.log('GET /jobs/v2/' + id);

        try {
            var j = await jobManager.get(id);
            if (!j) {
                response.json({
                    status: "error",
                    message: "Job " + id + " not found"
                });
                return;
            }

            response.json({
                status: "success",
                result: j
            });
        }
        catch (err) {
            response.json({
                status: "error",
                message: err
            });
        }
    });

    app.post('/jobs/v2', async (request, response) => {
        console.log("POST /jobs/v2\n", request.body);

        try {
            var j = new job.Job(request.body);
            await jobManager.submit(j);

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

    app.get('/profiles/v2/me', function(request, response) {
        console.log('GET /jobs/v2');

        response.json({
            status: "success",
            result: {
                email: "",
                first_name: "Matt",
                last_name: "Bomhoff",
                username: "mbomhoff"
            }
        });
    });
}
