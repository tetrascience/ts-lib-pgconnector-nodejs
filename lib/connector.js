'use strict';
'use strict';

const elv = require('elv');
const EventEmitter = require('events').EventEmitter;
const Kibbutz = require('kibbutz');
const pg = require('pg');

const errors = require('./errors');


const msg = {
  argPgLib: 'Argument "lib" must include a constructor for Pool',
  sharedInvalid: 'Shared must be set to null or an instance of Connector',
};


let shared = null;


class Connector {
  constructor(pgLib) {
    const lib = elv.coalesce(pgLib, pg);

    if (typeof lib.Pool !== 'function') {
      throw new TypeError(msg.argPgLib);
    }

    this._pg = pgLib;
    this._servers = new Map();
    this._repositories = new Map();
    this._emitter = new EventEmitter();
  }

  static get shared() { return shared; }
  static set shared(val) {
    if (val instanceof Connector || val === null) shared = val;
    else throw new TypeError(msg.sharedInvalid);
  }
}


module.exports = Connector;
