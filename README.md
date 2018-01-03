A mock Agave API access node for testing and developing Hadoop apps on a private cluster.

Setup
=====

Setup database:
```
cat occ-plan-b.sql | sqlite3 occ-plan-b.sqlite3
```

Modify configuration:

Edit config.json accordingly.  Make sure SSH public key is installed on target Hadoop server.

Running
=======
To try out:
```
npm install
npm start
```

For development:
```
npm install nodemon
nodemon server.js
```

For production:
```
sudo npm install pm2@latest -g
pm2 start --name occ-plan-b server.js
sudo pm2 startup systemd
```
