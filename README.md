Plan B
======

A service for deploying containerized jobs locally or on remote clusters.

##Setup

1. Create database
```
cat db.sql | sqlite3 db.sqlite3
```

2. Copy `config.json.default` to `config.json` and edit accordingly.  

3. Make sure SSH public key is installed on remote systems.

4. Configure IRODS for remote user on remote systems.

##Running

For development:
```
npm install nodemon -g
npm run dev
```

For production:
```
sudo npm install pm2@latest -g
pm2 start --name plan-b server.js
sudo pm2 startup systemd
```

##System Configuration
Add an entry to `systems.json`:

```
hostname        Hostname of the remote (or local) system.
type            Type of system: "server", "hpc", or "hadoop".
username        User on remote system.
stagingPath     Data staging directory on remote system.
ssh             (optional) Custom ssh command and parameters.  
                For example to ssh proxy use "ssh -J myuser@hpc.arizona.edu login.ocelote.hpc.arizona.edu".
env             (optional) Environment variables to set on remote system. 
                For example:
                  {
                    "IRODS_ENVIRONMENT_FILE": "/home/myuser/irods_environment.json",
                    "PATH": "/opt/irods/4.2.2/usr/bin:/home/myuser/bin"
                  }
targetHdfsPath  (type="hadoop") Data staging directory in HDFS.
hadoopJavaOpts  (type="hadoop", optional) Java command-line options for setting variables or memory limits.
```

##App Configuration
Add a TAPIS app description file to the `apps/` directory.  Set the `executionSystem` and `deploymentPath` fields to correspond to the target system specified in `systems.json`.

See the TAPIS documentation for more info on the app description file:<br> 
https://tacc-cloud.readthedocs.io/projects/agave/en/latest/agave/guides/apps/introduction.html

##REST API
The API closely resembles the TAPIS Jobs API:<br>
https://tacc-cloud.readthedocs.io/projects/agave/en/latest/agave/guides/jobs/introduction.html

```
GET /apps/[id]              Fetch app by ID
GET /jobs                   Fetch all jobs
GET /jobs/[id]              Fetch job by ID
GET /jobs/[id]/history      Fetch job history by ID
POST /jobs                  Submit job
```

All endpoints require a TAPIS authentication bearer token.


