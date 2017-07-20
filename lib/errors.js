'use strict';

const elv = require('elv');


const msg = {
  configuration: 'Invalid configuration',
  missingRepo: 'No repository found with the name ',
};


/**
 * Thrown when an invalid configuration is encountered.
 *
 * @extends Error
 *
 * @param {String} message
 * @param {*} [data]
 *
 * @property {String} message A human-readable description of the error.
 * @property {*} data Additional information about the error.
 */
function ConfigurationError(message, data) {
  Error.call(this);
  Error.captureStackTrace(this, ConfigurationError);

  this.message = elv.coalesce(message, msg.configuration);
  this.data = data;
}
ConfigurationError.defaultMessage = msg.configuration;
ConfigurationError.prototype = Object.create(Error.prototype);
ConfigurationError.prototype.constructor = ConfigurationError;


/**
 * Thrown when an invalid configuration is encountered.
 *
 * @extends Error
 *
 * @param {String} message
 * @param {*} [data]
 *
 * @property {String} message A human-readable description of the error.
 * @property {String} data The name of the repository missing a mapping.
 */
function MissingRepositoryError(repository) {
  Error.call(this);
  Error.captureStackTrace(this, MissingRepositoryError);

  const message = msg.missingRepo + repository;
  this.message = message;
  this.data = repository;
}
MissingRepositoryError.prototype = Object.create(Error.prototype);
MissingRepositoryError.prototype.constructor = MissingRepositoryError;


/**
 * @module errors
 *
 * @property {ConfigurationError} ConfigurationError
 * @property {MissingRepositoryError} MissingRepositoryError
 */
module.exports = {
  ConfigurationError,
  MissingRepositoryError,
};
