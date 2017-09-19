'use strict';

const cors = require('cors');
const job  = require('./models/job');
const bodyParser = require('body-parser');
const config = require('../config.json');


// Initialize job queue
job.init();

module.exports = function(app) {
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

    app.get('/jobs/v2', function(request, response) {
        console.log('GET /jobs/v2');

        var jobs = Object.values(job.get()).map(job => {
            return {
                id: job.id,
                name: job.name,
                appId: job.appId,
                startTime: job.startTime,
                endTime: job.endTime,
                status: job.statusString()
            }
        });

        response.json({
            status: "success",
            result: jobs
        });
    });

    app.get('/jobs/v2/:id(\\S+)', function(request, response) {
        var id = request.params.id;
        console.log('GET /jobs/v2/' + id);

        var j = job.get(id);
        if (!j) {
            response.json({
                status: "failure",
                message: "Job " + id + " not found"
            });
            return;
        }

        response.json({
            status: "success",
            result: {
                id: j.id,
                status: j.statusString(),
                appId: j.appId,
                name: j.name
            }
        });
    });

    app.post('/jobs/v2', function(request, response) {
        console.log('POST /jobs/v2');

        var j = new job.Job(request.body)
        j.submit();

        response.json({
            status: "success",
            result: {
                id: j.id
            }
        });
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
