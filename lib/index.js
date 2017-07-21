'use strict';

const elv = require('elv');
const EventEmitter = require('events').EventEmitter;
const Kibbutz = require('kibbutz');
const pg = require('pg');
const Promise = require('bluebird');

const errors = require('./errors');

const ConfigurationError = errors.ConfigurationError;
const MissingRepositoryError = errors.MissingRepositoryError;


const msg = {
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
  sharedInvalid: 'Shared must be set to null or an instance of Connector',
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
  return typeof obj === 'object'
         && !Array.isArray(obj)
         && !(obj instanceof Date);
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
      key,
      value: dbConf,
    });
  }

  if (!isNonEmptyString(dbConf.host)) {
    return new ConfigurationError(msg.dbConfHostStr, {
      key,
      value: dbConf,
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
let shared = null;


/**
 * Manages the creation and lifetime of PostgreSQL connection pools, and
 * provides an easy way to share them across modules in an application.
 *
 * @param {*} [pgLib] A reference to the "pg" library to use.
 */
class Connector {
  constructor(pgLib) {
    const lib = elv.coalesce(pgLib, pg);

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
  _assertRepo(repository) {
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
  _fillDatabasesMap(databases) {
    const keys = Object.keys(databases);

    if (keys.length === 0) return new ConfigurationError(msg.noDatabases);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const dbConf = databases[key];

      const databaseErr = validateDatabaseConf(key, dbConf);
      if (elv(databaseErr)) return databaseErr;

      const pool = new this._pg.Pool(dbConf);

      this.databases.set(key, {
        name: key,
        pool,
      });
    }

    return null;
  }


  /**
   * @private
   */
  _validateRepoConf(key, repoConf) {
    if (!isNonEmptyString(repoConf)) {
      return new ConfigurationError(msg.repoConfStr, key);
    }

    if (!this.databases.has(repoConf)) {
      return new ConfigurationError(msg.repoConfMapping, {
        key,
        value: repoConf,
      });
    }

    return null;
  }


  /**
   * @private
   */
  _fillReposMap(repositories) {
    const keys = Object.keys(repositories);

    if (keys.length === 0) return new ConfigurationError(msg.noRepositories);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const repoConf = repositories[key];

      const repoErr = this._validateRepoConf(key, repoConf);
      if (elv(repoErr)) return repoErr;

      this.repositories.set(key, {
        name: key,
        pool: this.databases.get(repoConf).pool,
        databaseName: repoConf,
      });
    }

    return null;
  }


  /**
   * @private
   */
  _fill(conf) {
    const validateErr = validateConf(conf);
    if (elv(validateErr)) return validateErr;

    const databasesErr = this._fillDatabasesMap(conf.databases);
    if (elv(databasesErr)) return databasesErr;

    const reposErr = this._fillReposMap(conf.repositories);
    return reposErr;
  }


  /**
   * The internal errors module.  This provides clients with references to the
   * custom error types thrown by Connector.
   *
   * @return {errors}
   */
  static get errors() { return errors; }


  /**
   * Gets or sets an instance of Connector to share across an application's
   * modules.
   *
   * @return {Connector|null}
   */
  static get shared() { return shared; }
  static set shared(val) {
    if (val instanceof Connector || val === null) shared = val;
    else throw new TypeError(msg.sharedInvalid);
  }


  /**
   * Adds additional repository mappings and database configurations to the
   * Connector instance.
   *
   * @param {Object} ...confData
   */
  add(...args) {
    if (args.length === 0) return this;

    const configurator = new Kibbutz();
    let vals = [];

    for (let i = 0; i < args.length; i++) {
      const val = args[i];
      if (Array.isArray(val)) vals = vals.concat(val);
      else vals.push(val);
    }

    configurator.append(vals);
    const fillErr = this._fill(configurator.value);

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
  connect(repository, callback) {
    // Note: we're throwing a hard error here, instead of returning
    // Promise.reject(), because this represents a problem with the client code
    // itself.  The app should cease running.
    //
    this._assertRepo(repository);
    assertCallback(callback);

    const repo = this.repositories.get(repository);
    const cbfn = callback;
    const self = this;

    const promiseFn = (resolve, reject) => {
      const resolveCallback = resolve;
      const rejectCallback = reject;

      try {
        repo.pool.connect((err, client, done) => {
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
  getPool(repository) {
    this._assertRepo(repository);
    const repo = this.repositories.get(repository);
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
  load(providers, value, callback) {
    if (!Array.isArray(providers)) throw new TypeError(msg.argProvidersArray);
    if (providers.length === 0) throw new TypeError(msg.argProvidersLen);

    let val;
    let cbfn;

    if (arguments.length === 2 && typeof value === 'function') {
      cbfn = value;
    } else {
      val = value;
      cbfn = callback;
    }

    assertCallback(cbfn);

    const options = (elv(val)) ? { value: val } : undefined;
    const self = this;
    const configurator = new Kibbutz(options);

    configurator
      .on('config', (fragment) => {
        self._emitter.emit('config', fragment);
      });

    const providerFns = providers;

    return new Promise((resolve, reject) => {
      const resolveCallback = resolve;
      const rejectCallback = reject;

      configurator.load(providerFns, (err, conf) => {
        if (elv(err)) {
          if (elv(cbfn)) cbfn(err);
          rejectCallback(err);
          return;
        }

        const fillErr = self._fill(conf);

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
  on(eventName, listener) {
    if (typeof eventName !== 'string' || eventName.length === 0) {
      throw new TypeError(msg.argEventNameStr);
    }

    if (typeof listener !== 'function') throw new TypeError(msg.argListenerFn);

    if (eventName !== 'config'
        && eventName !== 'done'
        && eventName !== 'error'
    ) {
      throw new Error(msg.argUnknownEventName + eventName);
    }

    this._emitter.on(eventName, listener);

    return this;
  }
}


module.exports = Connector;
