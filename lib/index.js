'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

require('buffer-v6-polyfill');

var elv = require('elv');
var EventEmitter = require('events').EventEmitter;
var Kibbutz = require('kibbutz');
var pg = require('pg');
var Promise = require('bluebird');

var errors = require('./errors');

var ConfigurationError = errors.ConfigurationError;
var MissingRepositoryError = errors.MissingRepositoryError;

var msg = {
  argCallback: 'Argument "callback" must be a function',
  argEventNameStr: 'Argument "eventName" must be a non-empty string',
  argUnknownEventName: 'Argument "eventName" references an unknown event: ',
  argListenerFn: 'Argument "listener" must be a function',
  argPgLib: 'Argument "lib" must include a constructor for Pool',
  argProvidersArray: 'Argument "providers" must be an array',
  argProvidersLen: 'Argument "providers" cannot be empty',
  argRepoStr: 'Argument "repository" must be a non-empty string',
  dbConfHostStr: 'Databases require a "host" key that is a non-empty string',
  dbConfPojo: 'Loaded configuration "databases" sub keys must be POJOs',
  databasesPojo: 'Loaded configuration\'s "databases" key must be a POJO',
  noDatabases: 'Loaded configuration does not contain any "databases"',
  reposPojo: 'Loaded configuration\'s "repositories" key must be a POJO',
  repoConfMapping: 'Configured repository is mapped to missing database name',
  repoConfStr: 'Loaded configuration "repositories" must non-empty strings',
  sharedInvalid: 'Shared must be set to null or an instance of Connector'
};

/**
 * A callback function given to and executed by the connect() method.
 * @typedef {Function} ConnectCallback
 * @param {Error|null} err
 * @param {Client} client
 * @param {Function} done
 */

//
// Validation helpers
//


function isPojo(obj) {
  return (typeof obj === 'undefined' ? 'undefined' : _typeof(obj)) === 'object' && !Array.isArray(obj) && !(obj instanceof Date);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function assertCallback(callback) {
  if (elv(callback) && typeof callback !== 'function') {
    throw new TypeError(msg.argCallback);
  }
}

function validateDatabaseConf(key, dbConf) {
  if (!elv(dbConf) || !isPojo(dbConf)) {
    return new ConfigurationError(msg.dbConfPojo, {
      key: key,
      value: dbConf
    });
  }

  if (!isNonEmptyString(dbConf.host)) {
    return new ConfigurationError(msg.dbConfHostStr, {
      key: key,
      value: dbConf
    });
  }

  return null;
}

function validateConf(conf) {
  if (!elv(conf.databases)) {
    return new ConfigurationError(msg.noDatabases, conf);
  }

  if (!isPojo(conf.databases)) {
    return new ConfigurationError(msg.databasesPojo, conf);
  }

  if (!elv(conf.repositories)) {
    return new ConfigurationError(msg.noRepositories, conf);
  }

  if (!isPojo(conf.repositories)) {
    return new ConfigurationError(msg.reposPojo, conf);
  }

  return null;
}

// Holds the static "shared" isntance of Connector.
//
var shared = null;

/**
 * Manages the creation and lifetime of PostgreSQL connection pools, and
 * provides an easy way to share them across modules in an application.
 *
 * @param {*} [pgLib] A reference to the "pg" library to use.
 */

var Connector = function () {
  function Connector(pgLib) {
    _classCallCheck(this, Connector);

    var lib = elv.coalesce(pgLib, pg);

    if (typeof lib.Pool !== 'function') {
      throw new TypeError(msg.argPgLib);
    }

    this._pg = lib;
    this.databases = new Map();
    this.repositories = new Map();
    this._emitter = new EventEmitter();
  }

  /**
   * @private
   */


  _createClass(Connector, [{
    key: '_assertRepo',
    value: function _assertRepo(repository) {
      if (!isNonEmptyString(repository)) {
        throw new TypeError(msg.argRepoStr);
      }

      if (!this.repositories.has(repository)) {
        throw new MissingRepositoryError(repository);
      }
    }

    /**
     * @private
     */

  }, {
    key: '_fillDatabasesMap',
    value: function _fillDatabasesMap(databases) {
      var keys = Object.keys(databases);

      if (keys.length === 0) return new ConfigurationError(msg.noDatabases);

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var dbConf = databases[key];

        var databaseErr = validateDatabaseConf(key, dbConf);
        if (elv(databaseErr)) return databaseErr;

        var pool = new this._pg.Pool(dbConf);

        this.databases.set(key, {
          name: key,
          pool: pool
        });
      }

      return null;
    }

    /**
     * @private
     */

  }, {
    key: '_validateRepoConf',
    value: function _validateRepoConf(key, repoConf) {
      if (!isNonEmptyString(repoConf)) {
        return new ConfigurationError(msg.repoConfStr, key);
      }

      if (!this.databases.has(repoConf)) {
        return new ConfigurationError(msg.repoConfMapping, {
          key: key,
          value: repoConf
        });
      }

      return null;
    }

    /**
     * @private
     */

  }, {
    key: '_fillReposMap',
    value: function _fillReposMap(repositories) {
      var keys = Object.keys(repositories);

      if (keys.length === 0) return new ConfigurationError(msg.noRepositories);

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var repoConf = repositories[key];

        var repoErr = this._validateRepoConf(key, repoConf);
        if (elv(repoErr)) return repoErr;

        this.repositories.set(key, {
          name: key,
          pool: this.databases.get(repoConf).pool,
          databaseName: repoConf
        });
      }

      return null;
    }

    /**
     * @private
     */

  }, {
    key: '_fill',
    value: function _fill(conf) {
      var validateErr = validateConf(conf);
      if (elv(validateErr)) return validateErr;

      var databasesErr = this._fillDatabasesMap(conf.databases);
      if (elv(databasesErr)) return databasesErr;

      var reposErr = this._fillReposMap(conf.repositories);
      return reposErr;
    }

    /**
     * The internal errors module.  This provides clients with references to the
     * custom error types thrown by Connector.
     *
     * @return {errors}
     */

  }, {
    key: 'add',


    /**
     * Adds additional repository mappings and database configurations to the
     * Connector instance.
     *
     * @param {Object} ...confData
     */
    value: function add() {
      for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }

      if (args.length === 0) return this;

      var configurator = new Kibbutz();
      var vals = [];

      for (var i = 0; i < args.length; i++) {
        var val = args[i];
        if (Array.isArray(val)) vals = vals.concat(val);else vals.push(val);
      }

      configurator.append(vals);
      var fillErr = this._fill(configurator.value);

      if (elv(fillErr)) throw fillErr;

      return this;
    }

    /**
     * Checks a Client out of the connection pool to which the given repository
     * name is mapped.
     *
     * @param {String} repository The name of the repository to which who's mapped
     * Pool you are connecting.
     * @param {ConnectCallback} [callback]
     *
     * @returns {Promise}
     */

  }, {
    key: 'connect',
    value: function connect(repository, callback) {
      // Note: we're throwing a hard error here, instead of returning
      // Promise.reject(), because this represents a problem with the client code
      // itself.  The app should cease running.
      //
      this._assertRepo(repository);
      assertCallback(callback);

      var repo = this.repositories.get(repository);
      var cbfn = callback;
      var self = this;

      var promiseFn = function promiseFn(resolve, reject) {
        var resolveCallback = resolve;
        var rejectCallback = reject;

        try {
          repo.pool.connect(function (err, client, done) {
            if (elv(err)) {
              if (elv(cbfn)) cbfn(err);
              rejectCallback(err);
              return;
            }

            if (elv(cbfn)) cbfn(null, client, done);
            resolveCallback(client);
          });
        } catch (e) {
          // If we reached this point, something horrible has happened.  Likely
          // an internal driver error.
          //
          self._emitter.emit('error', e);
        }
      };

      // Note: pg's Pool.prototype.connect() method returns a native Promise, and
      // provides no method to inject a different library.  We're wrapping that
      // functionality here to ensure a Bluebird Promise is returned.  Eventually,
      // we should find a way to ensure that all of pg's methods return Bluebird
      // Promises.  For now, this serves as the beginning of that effort.
      //
      return new Promise(promiseFn);
    }

    /**
     * Gets the pool to which the repository name is mapped.
     *
     * @param {String} repository The name of the repository to which who's mapped
     * Pool you are looking up.
     */

  }, {
    key: 'getPool',
    value: function getPool(repository) {
      this._assertRepo(repository);
      var repo = this.repositories.get(repository);
      return repo.pool;
    }

    /**
     * Loads information used to configure pg connection pools, and the
     * repositories that use them.
     *
     * @param {Array} providers An list of Kibbutz-styled configuration providers.
     * @param {Object} [value] A base configure object.
     * @param {Function} [callback] A function invoked after load() completes.
     *
     * @return {Promise}
     */

  }, {
    key: 'load',
    value: function load(providers, value, callback) {
      if (!Array.isArray(providers)) throw new TypeError(msg.argProvidersArray);
      if (providers.length === 0) throw new TypeError(msg.argProvidersLen);

      var val = void 0;
      var cbfn = void 0;

      if (arguments.length === 2 && typeof value === 'function') {
        cbfn = value;
      } else {
        val = value;
        cbfn = callback;
      }

      assertCallback(cbfn);

      var options = elv(val) ? { value: val } : undefined;
      var self = this;
      var configurator = new Kibbutz(options);

      configurator.on('config', function (fragment) {
        self._emitter.emit('config', fragment);
      });

      var providerFns = providers;

      return new Promise(function (resolve, reject) {
        var resolveCallback = resolve;
        var rejectCallback = reject;

        configurator.load(providerFns, function (err, conf) {
          if (elv(err)) {
            if (elv(cbfn)) cbfn(err);
            rejectCallback(err);
            return;
          }

          var fillErr = self._fill(conf);

          if (elv(fillErr)) {
            if (elv(cbfn)) cbfn(fillErr);
            rejectCallback(fillErr);
            return;
          }

          self._emitter.emit('done', conf);
          if (elv(cbfn)) cbfn(null, self);
          resolveCallback(self);
        });
      });
    }

    /**
     * Attaches a listener function to an event.  Possible events include: config
     * done, and error.
     *
     * @param {String} eventName
     * @param {Function} listener
     */

  }, {
    key: 'on',
    value: function on(eventName, listener) {
      if (typeof eventName !== 'string' || eventName.length === 0) {
        throw new TypeError(msg.argEventNameStr);
      }

      if (typeof listener !== 'function') throw new TypeError(msg.argListenerFn);

      if (eventName !== 'config' && eventName !== 'done' && eventName !== 'error') {
        throw new Error(msg.argUnknownEventName + eventName);
      }

      this._emitter.on(eventName, listener);

      return this;
    }
  }], [{
    key: 'errors',
    get: function get() {
      return errors;
    }

    /**
     * Gets or sets an instance of Connector to share across an application's
     * modules.
     *
     * @return {Connector|null}
     */

  }, {
    key: 'shared',
    get: function get() {
      return shared;
    },
    set: function set(val) {
      if (val instanceof Connector || val === null) shared = val;else throw new TypeError(msg.sharedInvalid);
    }
  }]);

  return Connector;
}();

module.exports = Connector;
