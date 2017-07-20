# ts-pgconnector

Manages the lifetime and configuration of [`pg`](https://www.npmjs.com/package/pg) connection pool instances.

__Table of Contents__
* [Configuration](#configuration)
* [Usage](#usage)
* [Repositories](#repositories)
* [Motivation](#motivation)
* [API](#api)

## Configuration

The `ts-pgconnector` module internally uses [`kibbutz`](https://www.npmjs.com/package/kibbutz) for configuration loading and aggregation (this allows you to load configuration from potentially multiple sources).  When all configuration is loaded and aggregated, the resulting object must have the following schema:

* `databases`: _(required)_ an object that contains a map of PostgreSQL configuration information.  Each key in the `databases` object coresponds to the a single database connection.  Each value must be an object that matches the `pg` module's [`Pool` class' configuration object](https://node-postgres.com/features/pooling).

* `repositories`: _(required)_ an object whose keys semantically align to the repositories in the project.  Each repository key's value is a string that maps to a key found in `databases`.

## Usage

First, add `ts-pgconnector` to your package.json's `dependencies`:

```sh
$ npm install tetrascience/ts-lib-pgconnector-nodejs
```

Then create a configuration file that defines your database connections and repository mappings:

At application startup load your configuration with the `Pgconnector` class:

__app.js__
```js
const Pgconnector = require('ts-pgconnector');

const provider = {
  load: (callback) => {
    const cbfn = callback;
    // load configuration from some source.
    goGetConfigAsync((err, conf) => {
      // ALWAYS invoke the callback through the event loop.  Kibbutz expects
      // that callbacks will be invoked after the load() method returns.
      // DO NOT RELEASE ZALGO!
      // http://blog.izs.me/post/59142742143/designing-apis-for-asynchrony
      setImmediate(cbfn, null, config);
    });
  },
};

Pgconnector.shared = new Pgconnector();
Pgconnector.shared.load([provider])
  .then(() => {
    server.start();
  })
  .catch(Pgconnector.errors.ConfigurationError, (err) => {
    console.log(err);
    process.exit(1);
  });
```

Your configuration object may look like this:

```json
{
  "databases": {
    "primary": {
      "host": "postgresql.tetrascience.local",
      "database": "tetrascience",
      "port": 3211,
      "user": "service",
      "password": "oU812"
    },
  },
  "repositories": {
    "devices": "primary",
    "users": "primary"
  }
}
```

Then in each repository simply ask `Pgconnector` for a client instance:

__users/repository.js__
```js
const elv = require('elv');
const Pgconnector = require('ts-pgconnector');

class UsersRepository {
  constructor(connector) {
    this._connector = elv.coalesce(connector, Pgconnector.shared);
    this.name = 'users'
  }

  findOne(id) {
    this._connector.connect(this.name)
      .then((client) => {
        return [
          client,
          client.query('SELECT * FROM users WHERE id = $1', [id]),
        ];
      })
      .then((result) => {
        const client = result[0];
        const rows = result[1];

        // release the client back into the pool
        client.release();

        // turn the result into a POJO representing a user
        return this._mapResult(rows);
      });
  }
}
```

## Repositories

The idea of creating "repositories" in your app is to compartmentalize all of the concerns around storing and querying data for a single model in a single app.  Repositories function as a service that provides access to an underlying data store.  This ensures that model code and persistence code are completely decoupled.  Repositories should never leak internal implementation details, and injest and receive basic identifiers and Plain Old JavaScript Objects (POJOs).

## Motivation

This module is built with the following goals in mind:

1. Provide a lot of the boilerplate of configuring database connections from configuration.

2. Ensure that a single connection pool is created for multiple repositories connecting to the same database, and avoid connection exhaustion at the database.

3. Provide a mechanism to handle the asynchronous loading of configuration from potentially multiple sources (example: environment variables + static configuration + Vault).  This hook allows implementers to ensure that configuration is fully loaded before the application server is started.

## API

The `ts-pgconnector` primary interface is a class called `Pgconnector`.  The following section is a list of all of its members.

### `new Pgconnector([pgLib])`

The constructor for the `Pgconnector` class.

__Parameters__

* `pgLib`: _(optional)_ a reference to the `pg` library to use within the `Pgconnector` class.  This provides a method of injecting a library for the purpose of unit testing.

### `Pgconnector.errors`

A reference to `ts-pgconnector`'s internal errors.  This is an object whose properties are references to all of the module's custom `Error` classes.

__Classes__

* `ConfigurationError`: thrown when an error is encountered while loading configuration artifacts.

* `MissingRepositoryError`: thrown when a `pg.Pool` or `pg.Client` is requested for a repository that does not exist in a `Pgconnector` instance's list of configured repositories.

### `Pgconnector.shared`

A convenience property for sharing `Pgconnector` instances across multiple modules in an application.  This static property is `null` by default.  It can be set to either `null` or an instance of `Pgconnector` (a `TypeError` is thrown if you try to set it to something else).

### `Pgconnector.prototype.add(fragments | ...fragments)`

Adds configuration artifacts to the instance of `Pgconnector`.  This is useful if you have loaded configuration from a source other than a Kibbutz provider (for example, via CommonJS).

All configuration fragments are subsequently merged, and `Pgconnector` attempts to establish any new database connections, and wire configured repositories.  If the final object is malformed, a `ConfigurationError` is thrown.

__Parameters__

* `fragments`: _(required)_ an array of configuration fragments.

_...or..._

* `...fragments`: _(required)_ n-number of configuration fragments provided as individual arguments.  If one of the fragments is an array, it is flattened, and all entries are merged individually.

__Returns__

The instance of `Pgconnector`.

### `Pgconnector.prototype.connect(repository [, callback])`

Gets a [`pg.Client`](https://node-postgres.com/api/client) instance from the `pg.Pool` to which the given `repository` is mapped.  This functions in much the same way as the `pg` module's own [`connect()`](https://node-postgres.com/features/pooling#checkout-use-and-return) method.

__Parameters__

* `repository`: _(required)_ a string that identifies the repository for which you are requesting a `pg.Client`.

* `callback`: _(optional)_ a callback function invoked when a `pg.Client` is made available.  This function has the signature:

  - `err`: the error object if one occurred.  Otherwise, this argument is `null` or `undefined`.

  - `client`: the `pg.Client` instance.

  - `release`: the function to call when you are ready to release the client back into the pool.

### `Pgconnector.prototype.getPool(repository)`

Gets the [`pg.Pool`](https://node-postgres.com/api/pool) representing the database connection to which the given `repository` is mapped.  If the given `repository` does not have a mapping, a `MissingRepositoryError` is thrown.

__Parameters__

* `repository`: _(required)_ a string that identifies the repository for which you are requesting a `pg.Pool`.

__Returns__

A `pg.Pool` instance.

### `Pgconnector.prototype.load(providers [, value] [, callback])`

Loads information used to configure pg connection pools, and the repositories that use them.  This method, internally, uses `kibbutz` to load and merge configuration fragments into a single object.  If the final object is malformed, a `ConfigurationError` is thrown.

__Parameters__

* `providers`: _(required)_ an array of [Kibbutz providers](https://www.npmjs.com/package/kibbutz#providers).

* `value`: _(optional)_ an object that will also be merged along with all loaded configuration fragements.

* `callback`: _(optional)_ a Node.js callback function.

__Returns__

A `Promise`.

### `Pgconnector.prototype.on(eventName, listener)`

Subscribes a listener to an event.

__Parameters__

* `eventName`: _(required)_ a string identifying the event to which you are subscribing.  [See below](#events) for valid event names.

* `listener`: _(required)_ a function to be called when the subscribed event occurs.

__Returns__

The instance of `Pgconnector`.

#### Events

* `config`: emitted when a configuration fragment is loaded.  Listener parameters:

  - `fragment`: the fragment that was loaded.

* `done`: emitted when all configuration fragments are loaded, merged, and ingested.  Listener parameters:

  - `conf`: the fully merged configuration object.

* `error`: emitted when an uncauth error occurs during while loading configuration, or opening a connection.  Listener parameters:

  - `err`: the error that occured.
