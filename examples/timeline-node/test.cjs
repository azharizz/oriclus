const assert = require('node:assert/strict');
const matches = require('minimatch');

assert.equal(matches('report.txt', '*.txt'), true);
assert.equal(matches('report.csv', '*.txt'), false);
