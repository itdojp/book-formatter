import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ErrorHandler } from '../src/ErrorHandler.js';

describe('ErrorHandler', () => {
  let errorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler();
  });

  describe('safeExecute', () => {
    it('should execute function successfully', async () => {
      const result = await errorHandler.safeExecute(
        () => 'success',
        'test operation'
      );
      
      assert.strictEqual(result, 'success');
    });

    it('should handle errors and return fallback result', async () => {
      const result = await errorHandler.safeExecute(
        () => { throw new Error('test error'); },
        'test operation',
        {
          fallback: () => 'fallback result',
          suppressError: true
        }
      );
      
      assert.strictEqual(result, 'fallback result');
    });

    it('should retry operations on failure', async () => {
      let attempts = 0;
      
      const result = await errorHandler.safeExecute(
        () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('retry test');
          }
          return 'success after retries';
        },
        'retry test',
        { retries: 2, suppressError: true }
      );
      
      assert.strictEqual(result, 'success after retries');
      assert.strictEqual(attempts, 3);
    });

    it('should handle timeout', async () => {
      const result = await errorHandler.safeExecute(
        () => new Promise(resolve => setTimeout(() => resolve('slow'), 2000)),
        'timeout test',
        { 
          timeout: 100,
          suppressError: true,
          fallback: () => 'timeout fallback'
        }
      );
      
      assert.strictEqual(result, 'timeout fallback');
    });
  });

  describe('validateInput', () => {
    it('should validate required parameters', () => {
      assert.throws(() => {
        errorHandler.validateInput(
          { name: 'test' },
          { 
            name: { required: true, type: 'string' },
            age: { required: true, type: 'number' }
          }
        );
      }, /Required parameter 'age' is missing/);
    });

    it('should validate parameter types', () => {
      assert.throws(() => {
        errorHandler.validateInput(
          { name: 123 },
          { name: { required: true, type: 'string' } }
        );
      }, /Parameter 'name' must be of type string/);
    });

    it('should pass validation for valid input', () => {
      assert.doesNotThrow(() => {
        errorHandler.validateInput(
          { name: 'test', age: 25 },
          { 
            name: { required: true, type: 'string' },
            age: { required: true, type: 'number' }
          }
        );
      });
    });
  });

  describe('formatUserError', () => {
    it('should format common Node.js errors', () => {
      const error = new Error('test');
      error.code = 'ENOENT';
      error.path = '/test/path';
      
      const formatted = errorHandler.formatUserError(error);
      assert(formatted.includes('ファイルまたはディレクトリが見つかりません'));
      assert(formatted.includes('/test/path'));
    });

    it('should format JSON parse errors', () => {
      const error = new Error('Unexpected token in JSON');
      const formatted = errorHandler.formatUserError(error);
      assert(formatted.includes('JSONの構文を確認'));
    });

    it('should return original message for unknown errors', () => {
      const error = new Error('Unknown error type');
      const formatted = errorHandler.formatUserError(error);
      assert.strictEqual(formatted, 'Unknown error type');
    });
  });

  describe('enhanceError', () => {
    it('should enhance error with context', () => {
      errorHandler.setContext('test context');
      const originalError = new Error('original message');
      
      const enhanced = errorHandler.enhanceError(originalError, 'test operation');
      
      assert(enhanced.message.includes('test operation'));
      assert(enhanced.message.includes('test context'));
      assert(enhanced.message.includes('original message'));
      assert.strictEqual(enhanced.originalError, originalError);
    });
  });

  describe('getStats', () => {
    it('should track error and warning counts', async () => {
      // Generate some errors
      await errorHandler.safeExecute(
        () => { throw new Error('test'); },
        'test',
        { suppressError: true }
      );
      
      errorHandler.logWarning('test warning');
      
      const stats = errorHandler.getStats();
      assert.strictEqual(stats.errors, 1);
      assert.strictEqual(stats.warnings, 1);
      assert.strictEqual(stats.hasErrors, true);
      assert.strictEqual(stats.hasWarnings, true);
    });

    it('should reset stats', () => {
      errorHandler.logWarning('test');
      errorHandler.reset();
      
      const stats = errorHandler.getStats();
      assert.strictEqual(stats.errors, 0);
      assert.strictEqual(stats.warnings, 0);
    });
  });

  describe('createSafeFileSystem', () => {
    it('should create safe file system wrapper', () => {
      const mockFs = {
        readFile: async () => 'content',
        writeFile: async () => {},
        ensureDir: async () => {},
        copy: async () => {},
        pathExists: async () => true
      };
      
      const safeFs = errorHandler.createSafeFileSystem(mockFs);
      
      assert(typeof safeFs.readFile === 'function');
      assert(typeof safeFs.writeFile === 'function');
      assert(typeof safeFs.ensureDir === 'function');
      assert(typeof safeFs.copy === 'function');
      assert(typeof safeFs.pathExists === 'function');
    });

    it('should handle file operation errors safely', async () => {
      const mockFs = {
        readFile: async () => { throw new Error('File not found'); },
        pathExists: async () => { throw new Error('Access denied'); }
      };
      
      const safeFs = errorHandler.createSafeFileSystem(mockFs);
      
      // readFile should throw enhanced error
      await assert.rejects(
        () => safeFs.readFile('/test/path'),
        /Failed during reading file \/test\/path/
      );
      
      // pathExists should return false on error
      const exists = await safeFs.pathExists('/test/path');
      assert.strictEqual(exists, false);
    });
  });
});