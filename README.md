A mock Agave API access node for testing and developing Hadoop apps on a private cluster.

Setup
=====

Setup database:
```
cat db.sql | sqlite3 db.sqlite3
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
pm2 start --name plan-b server.js
sudo pm2 startup systemd
```
