'use strict';

const http = require('node:http');
const config = require('./src/config');
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');

const db = openDb(config.dbPath);
const server = http.createServer(createApp({ db, config }));

server.listen(config.port, () => {
  console.log(`Referral Portal running on http://localhost:${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => {
    db.close();
    process.exit(0);
  }));
}
