'use strict';

const assert = require('chai').assert;

const errors = require('../../lib/errors');

const ConfigurationError = errors.ConfigurationError;
const MissingRepositoryError = errors.MissingRepositoryError;


describe('ConfigurationError', () => {
  it('should set message to provided message', () => {
    const msg = 'abc';
    const result = new ConfigurationError(msg);
    assert.strictEqual(result.message, msg);
  });

  it('should default message when not provided', () => {
    const result = new ConfigurationError();
    assert.strictEqual(result.message, ConfigurationError.defaultMessage);
  });

  it('should set data value when provided', () => {
    const dataz = { oh: 'hai' };
    const result = new ConfigurationError(null, dataz);
    assert.strictEqual(result.data, dataz);
  });
});


describe('MissingRepositoryError', () => {
  it('should set message to end with repository name', () => {
    const repo = 'test';
    const result = new MissingRepositoryError(repo);
    assert.isTrue(result.message.endsWith(repo));
  });

  it('should set data to repository name', () => {
    const repo = 'test';
    const result = new MissingRepositoryError(repo);
    assert.strictEqual(result.data, repo);
  });
});
