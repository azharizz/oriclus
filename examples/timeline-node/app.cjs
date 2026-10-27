const matches = require('minimatch');

module.exports = (name, pattern) => matches(name, pattern);
