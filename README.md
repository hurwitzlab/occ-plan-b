A mock Agave API access node for deploying jobs locally or on remote clusters.

Setup
=====

Setup database:
```
cat db.sql | sqlite3 db.sqlite3
```

Edit config.json accordingly.  

Make sure SSH public key is installed on target Hadoop server.

Running
=======

For development:
```
npm install nodemon
nodemon server.js
```

For production:
```
sudo npm install pm2@latest -g
pm2 start --name plan-b server.js
sudo pm2 startup systemd
```
