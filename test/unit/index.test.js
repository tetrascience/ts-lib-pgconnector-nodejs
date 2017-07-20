'use strict';

const assert = require('chai').assert;
const Bluebird = require('bluebird'); // usually this would be called Promise

const Connector = require('../../lib');
const errors = require('../../lib/errors');


class MockPool {
  /* eslint-disable class-methods-use-this */
  connect(callback) {
    setImmediate(callback, null, {}, () => {});
  }
  /* eslint-enable class-methods-use-this */
}


class MockFailPool {
  /* eslint-disable class-methods-use-this */
  connect(callback) {
    setImmediate(callback, new Error('LEEEEROY JENKINS!'));
  }
  /* eslint-enable class-methods-use-this */
}


class MockBadDriverPool {
  /* eslint-disable class-methods-use-this */
  connect() {
    throw new Error('Everything is terrible');
  }
  /* eslint-enable class-methods-use-this */
}


const mockLib = { Pool: MockPool };
const mockFailLib = { Pool: MockFailPool };
const mockBadDriverLib = { Pool: MockBadDriverPool };


describe('Connector', () => {
  beforeEach(function() {
    const conf = {
      databases: {
        primary: { host: '127.0.0.1' },
      },
      repositories: {
        test: 'primary',
      },
    };

    this.connector = new Connector(mockLib);
    this.connector.add(conf);

    this.failConnector = new Connector(mockFailLib);
    this.failConnector.add(conf);

    this.badDriverConnector = new Connector(mockBadDriverLib);
    this.badDriverConnector.add(conf);
  });


  describe('.constructor', () => {
    it('should throw if pgLib does not include a Pool class', function() {
      assert.throws(() => {
        const connector = new Connector({});
        assert.isNotOk(connector);
      });
    });

    it('should not throw if pgLib contains a Pool class', function() {
      assert.doesNotThrow(() => {
        const connector = new Connector(mockLib);
        assert.isOk(connector);
      });
    });

    it('should not throw if pgLib not provided', function() {
      assert.doesNotThrow(() => {
        const connector = new Connector();
        assert.isOk(connector);
      });
    });

    it('should use provided lib\'s Pool when creating connections', function() {
      let called = false;
      const Pool = function() { called = true; };
      const connector = new Connector({ Pool });

      connector.add({
        databases: {
          primary: {
            host: 'localhost',
          },
        },
        repositories: {
          test: 'primary',
        },
      });

      assert.isTrue(called);
    });
  });


  describe('.shared', function() {
    afterEach(function() {
      Connector.shared = null;
    });

    it('should be null by default', function() {
      assert.isNull(Connector.shared);
    });

    it('should throw if set to something not null or Connector', function() {
      assert.throws(() => {
        Connector.shared = 42;
      }, TypeError);
    });

    it('should not throw if set to null', function() {
      assert.doesNotThrow(() => {
        Connector.shared = null;
      }, TypeError);
    });

    it('should not throw if set to Connector instance', function() {
      assert.doesNotThrow(() => {
        Connector.shared = new Connector();
      }, TypeError);
    });

    it('should return set Connector instance', function() {
      const connector = new Connector();
      Connector.shared = connector;
      assert.strictEqual(Connector.shared, connector);
    });
  });


  describe('.errors', function() {
    it('should include ConfigurationError', function() {
      assert.strictEqual(
        Connector.errors.ConfigurationError,
        errors.ConfigurationError
      );
    });

    it('should include MissingRepositoryError', function() {
      assert.strictEqual(
        Connector.errors.MissingRepositoryError,
        errors.MissingRepositoryError
      );
    });
  });


  describe('#add', function() {
    it('should do nothing if no arguments provided', function() {
      const connector = new Connector();
      connector.add();
      assert.strictEqual(connector.databases.size, 0);
      assert.strictEqual(connector.repositories.size, 0);
    });

    it('should merge fragments from array', function() {
      const connector = new Connector();

      connector.add([
        {
          databases: {
            primary: { host: '127.0.0.1' },
          },
        },
        {
          repositories: {
            test: 'primary',
          },
        },
      ]);

      assert.isTrue(connector.databases.has('primary'));
      assert.isTrue(connector.repositories.has('test'));
    });

    it('should merge fragments from multiple arguments', function() {
      const connector = new Connector();

      connector.add(
        {
          databases: {
            primary: { host: '127.0.0.1' },
          },
        },
        {
          repositories: {
            test: 'primary',
          },
        }
      );

      assert.isTrue(connector.databases.has('primary'));
      assert.isTrue(connector.repositories.has('test'));
    });

    it('should concat array of fragments from multiple arguments', function() {
      const connector = new Connector();

      connector.add(
        {
          databases: {
            primary: { host: '127.0.0.1' },
          },
        },
        [
          {
            repositories: {
              test1: 'primary',
            },
          },
          {
            repositories: {
              test2: 'primary',
            },
          },
        ]
      );

      assert.isTrue(connector.databases.has('primary'));
      assert.isTrue(connector.repositories.has('test1'));
      assert.isTrue(connector.repositories.has('test2'));
    });

    it('should throw if merged conf missing databases', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            repositories: {
              test0: 'primary',
            },
          },
          {
            repositories: {
              test1: 'primary',
            },
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if merged conf databases not POJO', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: new Date(),
          },
          {
            repositories: {
              test: 'primary',
            },
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if merged conf databases empty', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {},
          },
          {
            repositories: {
              test: 'primary',
            },
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if merged conf missing repositories', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {
              primary: { host: '127.0.0.1' },
            },
          },
          {
            database: {
              secondary: { host: '127.0.0.2' },
            },
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if merged conf repositories not POJO', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {
              primary: { host: '127.0.0.1' },
            },
          },
          {
            repositories: [],
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if merged conf repositories empty', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {
              primary: { host: '127.0.0.1' },
            },
          },
          {
            repositories: {},
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if conf database not POJO', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {
              primary: 'wrong!',
            },
          },
          {
            repositories: {
              test: 'primary',
            },
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if conf database host missing', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {
              primary: {},
            },
          },
          {
            repositories: {
              test: 'primary',
            },
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if conf database host not a string', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {
              primary: { host: 42 },
            },
          },
          {
            repositories: {
              test: 'primary',
            },
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if conf database host an empty string', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {
              primary: { host: '' },
            },
          },
          {
            repositories: {
              test: 'primary',
            },
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if conf repositories not a string', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {
              primary: { host: '12.0.0.1' },
            },
          },
          {
            repositories: {
              test: 42,
            },
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if conf repositories an empty string', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {
              primary: { host: '12.0.0.1' },
            },
          },
          {
            repositories: {
              test: '',
            },
          }
        );
      }, errors.ConfigurationError);
    });

    it('should throw if repository mapped to missing database', function() {
      const connector = new Connector();

      assert.throws(() => {
        connector.add(
          {
            databases: {
              primary: { host: '12.0.0.1' },
            },
          },
          {
            repositories: {
              test: 'blorg',
            },
          }
        );
      }, errors.ConfigurationError);
    });
  });


  describe('#connect', () => {
    it('should throw if repository not a string', function() {
      assert.throws(() => {
        this.connector.connect(42);
      }, TypeError);
    });

    it('should throw if repository an empty string', function() {
      assert.throws(() => {
        this.connector.connect('');
      }, TypeError);
    });

    it('should throw if repository is missing', function() {
      assert.throws(() => {
        this.connector.connect('blorg');
      }, errors.MissingRepositoryError);
    });

    it('should throw if callback not a function', function() {
      assert.throws(() => {
        this.connector.connect('test', 42);
      }, TypeError);
    });

    it('should return a bluebird Promise', function() {
      const result = this.connector.connect('test');
      assert.instanceOf(result, Bluebird);
    });

    it('should call callback on connection error', function(done) {
      const callback = function(err) {
        assert.isOk(err);
        done();
      };

      try {
        this.failConnector.connect('test', callback).catch(() => {});
      } catch (err) {
        done(err);
      }
    });

    it('should emit error on driver error', function(done) {
      this.badDriverConnector.on('error', (err) => {
        assert.isOk(err);
        done();
      });

      try {
        this.badDriverConnector.connect('test');
      } catch (err) {
        done(err);
      }
    });

    it('should reject Promise on connection error', function(done) {
      try {
        this.failConnector.connect('test')
          .catch((err) => {
            assert.isOk(err);
            done();
          });
      } catch (err) {
        done(err);
      }
    });

    it('should call callback on success', function(done) {
      const callback = function(err, client, release) {
        assert.isNotOk(err);
        assert.isOk(client);
        assert.isFunction(release);
        done();
      };

      try {
        this.connector.connect('test', callback);
      } catch (err) {
        done(err);
      }
    });

    it('should resolve Promise on success', function(done) {
      try {
        this.connector.connect('test')
          .then((client) => {
            assert.isOk(client);
            done();
          });
      } catch (err) {
        done(err);
      }
    });
  });


  describe('#getPool', () => {
    it('should throw if repository not a string', function() {
      assert.throws(() => {
        this.connector.getPool(42);
      }, TypeError);
    });

    it('should throw if repository an empty string', function() {
      assert.throws(() => {
        this.connector.getPool('');
      }, TypeError);
    });

    it('should throw if repository is missing', function() {
      assert.throws(() => {
        this.connector.getPool('nopers');
      }, errors.MissingRepositoryError);
    });

    it('should return Pool if found', function() {
      const result = this.connector.getPool('test');
      assert.instanceOf(result, MockPool);
    });
  });


  describe('#load', () => {
    const provider1 = {
      load: (callback) => {
        const conf = {
          databases: {
            secondary: { host: '127.0.0.2' },
          },
          repositories: {
            foo: 'secondary',
          },
        };

        setImmediate(callback, null, conf);
      },
    };

    const provider2 = {
      load: (callback) => {
        const conf = {
          repositories: {
            bar: 'secondary',
          },
        };

        setImmediate(callback, null, conf);
      },
    };

    const failProvider = {
      load: (callback) => {
        setImmediate(callback, new Error('OH NOEZ!'));
      },
    };

    it('should throw if providers not array', function() {
      assert.throws(() => {
        this.connector.load(42);
      }, TypeError);
    });

    it('should throw if providers length is 0', function() {
      assert.throws(() => {
        this.connector.load([]);
      }, TypeError);
    });

    it('should throw if callback not a function', function() {
      assert.throws(() => {
        this.connector.load([provider1], null, 42);
      }, TypeError);
    });

    it('should throw if value is defined and not object', function() {
      assert.throws(() => {
        this.connector.load([provider1], 42);
      }, TypeError);
    });

    it('should use second arg as callback if func and 2 args', function(done) {
      try {
        this.connector.load([provider1], () => {
          done();
        });
      } catch (err) {
        done(err);
      }
    });

    it('should use third arg as callback if func and 3 args', function(done) {
      try {
        this.connector.load([provider1], null, () => {
          done();
        });
      } catch (err) {
        done(err);
      }
    });

    it('should use value as base config', function(done) {
      try {
        const base = {
          repositories: {
            qux: 'primary',
          },
        };

        this.connector.load([provider1], base, (err, conn) => {
          assert.isTrue(conn.repositories.has('qux'));
          done();
        });
      } catch (err) {
        done(err);
      }
    });

    it('should emit config event when config loaded', function(done) {
      this.connector.on('config', (conf) => {
        assert.isOk(conf);
        done();
      });

      try {
        this.connector.load([provider1]);
      } catch (err) {
        done(err);
      }
    });

    it('should emit done event when full config loaded', function(done) {
      this.connector.on('done', (conf) => {
        assert.isOk(conf);
        done();
      });

      try {
        this.connector.load([provider1, provider2]);
      } catch (err) {
        done(err);
      }
    });

    it('should call callback with err on failure', function(done) {
      try {
        this.connector.load([failProvider], (err) => {
          assert.isOk(err);
          done();
        }).catch(() => {});
      } catch (err) {
        done(err);
      }
    });

    it('should reject promise on failure', function(done) {
      try {
        this.connector.load([failProvider])
          .catch((err) => {
            assert.isOk(err);
            done();
          });
      } catch (err) {
        done(err);
      }
    });

    it('should call callback with self on success', function(done) {
      try {
        const self = this.connector;
        this.connector.load([provider1], (err, conn) => {
          assert.strictEqual(self, conn);
          done();
        });
      } catch (err) {
        done(err);
      }
    });

    it('should resolve Promise with self on success', function(done) {
      try {
        const self = this.connector;
        this.connector.load([provider1])
          .then((conn) => {
            assert.strictEqual(self, conn);
            done();
          });
      } catch (err) {
        done(err);
      }
    });

    it('should merge fragments from multiple providers', function(done) {
      try {
        this.connector.load([provider1, provider2], (err, conn) => {
          assert.isTrue(conn.databases.has('secondary'));
          assert.isTrue(conn.repositories.has('foo'));
          assert.isTrue(conn.repositories.has('bar'));
          done();
        });
      } catch (err) {
        done(err);
      }
    });

    it('should callback with err if conf invalid', function(done) {
      const provider = {
        load: (callback) => {
          setImmediate(callback, null, {
            repositories: {
              qux: 'primary',
            },
          });
        },
      };

      try {
        this.connector.load([provider], (err) => {
          assert.instanceOf(err, errors.ConfigurationError);
          done();
        }).catch(() => {});
      } catch (err) {
        done(err);
      }
    });

    it('should reject if conf invalid', function(done) {
      const provider = {
        load: (callback) => {
          setImmediate(callback, null, {
            repositories: {
              qux: 'primary',
            },
          });
        },
      };

      try {
        this.connector.load([provider])
          .catch((err) => {
            assert.instanceOf(err, errors.ConfigurationError);
            done();
          });
      } catch (err) {
        done(err);
      }
    });

    it('should map repository to correct Pool', function(done) {
      try {
        this.connector.load([provider1])
          .then((conn) => {
            const result = conn.getPool('foo');
            assert.strictEqual(result, conn.databases.get('secondary').pool);
            done();
          });
      } catch (err) {
        done(err);
      }
    });
  });


  describe('#on', () => {
    it('should throw if eventName not a string', function() {
      assert.throws(() => {
        this.connector.on(42, () => {});
      }, TypeError);
    });

    it('should throw if eventName empty string', function() {
      assert.throws(() => {
        this.connector.on('', () => {});
      }, TypeError);
    });

    it('should throw if listener not function', function() {
      assert.throws(() => {
        this.connector.on('config', 42);
      }, TypeError);
    });

    it('should throw if eventName not config, done or error', function() {
      assert.throws(() => {
        this.connector.on('boop', () => {});
      }, Error);
    });

    it('should succeed when adding config', function() {
      assert.doesNotThrow(() => {
        this.connector.on('config', () => {});
      });
    });

    it('should succeed when adding done', function() {
      assert.doesNotThrow(() => {
        this.connector.on('done', () => {});
      });
    });

    it('should succeed when adding error', function() {
      assert.doesNotThrow(() => {
        this.connector.on('error', () => {});
      });
    });

    it('should return self', function() {
      const result = this.connector.on('done', () => {});
      assert.strictEqual(result, this.connector);
    });
  });
});
