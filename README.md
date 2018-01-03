A mock Agave API access node for testing and developing Hadoop apps on a private cluster.

Installation
============

Setup database:
```
cat occ-plan-b.sql | sqlite3 occ-plan-b.sqlite3
```

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
pm2 start --name server.js
sudo pm2 startup systemd
```
