'use strict';

const { Job } = require('./models/job');
const cors = require('cors');
const bodyParser = require('body-parser');
const requestp = require('request-promise');


class MyError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

const ERR_NOT_FOUND = new MyError("Not found", 404);

module.exports = function(app, apps, jobManager) {
    app.use(cors());
    app.use(bodyParser.json()); // support json encoded bodies
    app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

    app.use(requestLogger);
    app.use(authenticate); // Tapis authentication

    app.get('/apps/:id(\\S+)', requireAuth, function(request, response) {
        const id = request.params.id;

        if (typeof apps[id] === 'undefined') {
            response.status(404).json({
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

    app.get('/jobs', requireAuth, async (request, response) => {
        let jobs = await jobManager.getJobs(request.auth.profile.username);
        if (jobs) {
            jobs = jobs.map(j => {
                delete j.inputs;
                delete j.parameters;
                j.owner = j.username;

                // Alias start/end times for consistency with Tapis/Aloe
                j.created = j.startTime;
                j.ended = j.endTime;

                return j;
            });
        }

        response.json({
            status: "success",
            result: jobs || []
        });
    });

    app.get('/jobs/:id([\\w\\-]+)', requireAuth, async (request, response) => {
        try {
            let job = await jobManager.getJob(request.params.id, request.auth.profile.username);
            if (!job)
                throw(ERR_NOT_FOUND);

            job.owner = job.username;

            // Alias start/end times for consistency with Tapis/Aloe
            job.created = job.startTime;
            job.ended = job.endTime;

            response.json({
                status: "success",
                result: job
            });
        }
        catch(error) {
            errorHandler(error, request, response);
        };
    });

    app.get('/jobs/:id([\\w\\-]+)/history', requireAuth, async (request, response) => {
        try {
            let job = await jobManager.getJob(request.params.id, request.auth.profile.username);
            if (!job)
                throw(ERR_NOT_FOUND);

            response.json({
                status: "success",
                result: job.history
            });
        }
        catch(error) {
            errorHandler(error, request, response);
        };
    });

    app.post('/jobs/:id([\\w\\-]+)/pems/:username([\\w\\-]+)', async (request, response) => {
        // Empty stub -- all jobs are public
        response.json({
            status: "success",
        });
    });

    app.post('/jobs', requireAuth, async (request, response) => {
        let j = new Job(request.body);
        j.username = request.auth.profile.username;
        j.token = request.auth.profile.token;
        await jobManager.submitJob(j);

        response.json({
            status: "success",
            result: {
                id: j.id
            }
        });
    });

    app.use(errorHandler);

    // Catch-all function
    app.get('*', function(req, res, next) {
        res.status(404).send("Unknown route: " + req.path);
    });
}

function requestLogger(req, res, next) {
    console.log(["REQUEST:", req.method, req.url].join(" ").concat(" ").padEnd(80, "-"));
    next();
}

function errorHandler(error, req, res, next) {
    console.log("ERROR ".padEnd(80, "!"));
    console.log(error.stack);

    let status = error.status || 500;
    let message = error.message || "Unknown error";

    res.status(status).send(message);
}

// Middleware to force authentication
function requireAuth(req, res, next) {
    console.log("REQUIRE AUTH")
    if (!req || !req.auth || !req.auth.validToken || !req.auth.profile) {
        const err = new Error('Unauthorized');
        err.status = 401;
        next(err);
    }
    else {
        next();
    }
}

// Middleware to validate Tapis bearer token
async function authenticate(req, res, next) {
    let token;
    if (req && req.headers)
        token = req.headers.authorization;
    console.log("authenticate: token:", token);

    req.auth = {
        validToken: false
    };

    if (!token)
        next();
    else {
        try {
            const response = await getProfile(token);
            if (!response || response.status != "success") {
                console.log('authenticate: !!!! Bad profile status: ' + response.status);
                return;
            }

            console.log("authenticate: *** success ***  username:", response.result.username);
            response.result.token = token;

            req.auth = {
                validToken: true,
                profile: response.result
            };
        }
        catch(error) {
            console.log("authenticate: !!!!", error.message);
        }
        finally {
            next();
        }
    }
}

function getProfile(token) {
    return requestp({
        method: "GET",
        uri: "https://agave.iplantc.org/profiles/v2/me", //FIXME hardcoded
        headers: {
            Authorization: token,
            Accept: "application/json"
        },
        json: true
    });
}