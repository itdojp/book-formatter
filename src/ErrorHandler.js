/**
 * Error handling utilities for Book Formatter
 * Provides consistent error handling and user-friendly messages
 */

export class ErrorHandler {
  constructor() {
    this.errorCount = 0;
    this.warningCount = 0;
    this.context = '';
  }

  /**
   * Set current operation context for better error messages
   * @param {string} context - Current operation context
   */
  setContext(context) {
    this.context = context;
  }

  /**
   * Handle and wrap errors with additional context
   * @param {Function} operation - Function to execute safely
   * @param {string} operationName - Name of the operation for error messages
   * @param {Object} options - Error handling options
   * @returns {Promise|any} Result of operation or null if failed
   */
  async safeExecute(operation, operationName, options = {}) {
    const {
      fallback = null,
      suppressError = false,
      timeout = 30000,
      retries = 0
    } = options;

    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`🔄 Retrying ${operationName} (attempt ${attempt + 1}/${retries + 1})`);
        }

        // タイムアウト付きで実行
        const result = await this.executeWithTimeout(operation, timeout, operationName);
        
        if (attempt > 0) {
          console.log(`✅ ${operationName} succeeded on retry ${attempt}`);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        this.errorCount++;
        
        if (attempt === retries) {
          // 最後の試行も失敗
          if (!suppressError) {
            this.logError(error, operationName);
          }
          
          if (fallback && typeof fallback === 'function') {
            try {
              console.log(`🔧 Executing fallback for ${operationName}`);
              return await fallback(error);
            } catch (fallbackError) {
              this.logError(fallbackError, `${operationName} fallback`);
            }
          }
          
          if (!suppressError) {
            throw this.enhanceError(error, operationName);
          }
          
          return null;
        }
        
        // リトライする場合は少し待機
        if (attempt < retries) {
          await this.delay(Math.pow(2, attempt) * 1000); // Exponential backoff
        }
      }
    }
  }

  /**
   * Execute operation with timeout
   * @param {Function} operation - Operation to execute
   * @param {number} timeout - Timeout in milliseconds
   * @param {string} operationName - Name for error messages
   * @returns {Promise} Operation result
   */
  async executeWithTimeout(operation, timeout, operationName) {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation '${operationName}' timed out after ${timeout}ms`));
      }, timeout);

      try {
        const result = await operation();
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Enhance error with additional context
   * @param {Error} error - Original error
   * @param {string} operationName - Operation that failed
   * @returns {Error} Enhanced error
   */
  enhanceError(error, operationName) {
    const enhancedError = new Error(
      `Failed during ${operationName}${this.context ? ` in ${this.context}` : ''}: ${error.message}`
    );
    enhancedError.originalError = error;
    enhancedError.operation = operationName;
    enhancedError.context = this.context;
    enhancedError.stack = error.stack;
    
    return enhancedError;
  }

  /**
   * Log error with consistent formatting
   * @param {Error} error - Error to log
   * @param {string} operationName - Operation that failed
   */
  logError(error, operationName) {
    console.error(`❌ Error in ${operationName}:`, {
      message: error.message,
      context: this.context,
      stack: error.stack
    });
  }

  /**
   * Log warning with consistent formatting
   * @param {string} message - Warning message
   * @param {string} operationName - Operation that generated warning
   */
  logWarning(message, operationName = '') {
    this.warningCount++;
    console.warn(`⚠️  Warning${operationName ? ` in ${operationName}` : ''}:`, message);
  }

  /**
   * Validate input parameters
   * @param {Object} params - Parameters to validate
   * @param {Object} schema - Validation schema
   * @throws {Error} If validation fails
   */
  validateInput(params, schema) {
    for (const [key, rules] of Object.entries(schema)) {
      const value = params[key];
      
      if (rules.required && (value === undefined || value === null)) {
        throw new Error(`Required parameter '${key}' is missing`);
      }
      
      if (value !== undefined && rules.type && typeof value !== rules.type) {
        throw new Error(`Parameter '${key}' must be of type ${rules.type}, got ${typeof value}`);
      }
      
      if (rules.validator && !rules.validator(value)) {
        throw new Error(`Parameter '${key}' failed validation: ${rules.message || 'Invalid value'}`);
      }
    }
  }

  /**
   * Create user-friendly error messages
   * @param {Error} error - Error to format
   * @returns {string} User-friendly error message
   */
  formatUserError(error) {
    const commonErrors = {
      'ENOENT': 'ファイルまたはディレクトリが見つかりません',
      'EACCES': 'ファイルへのアクセス権限がありません',
      'EMFILE': 'ファイルが多すぎます。一部のファイルを閉じてから再試行してください',
      'ENOSPC': 'ディスク容量が不足しています',
      'ENOTDIR': '指定されたパスはディレクトリではありません',
      'EISDIR': '指定されたパスはディレクトリです',
      'EPERM': '操作が許可されていません',
      'ETIMEDOUT': '操作がタイムアウトしました'
    };

    // Node.js エラーコードをチェック
    if (error.code && commonErrors[error.code]) {
      return `${commonErrors[error.code]}: ${error.path || error.message}`;
    }

    // JSON パースエラー
    if (error.message.includes('JSON')) {
      return '設定ファイルの形式が正しくありません。JSONの構文を確認してください。';
    }

    // YAML パースエラー
    if (error.message.includes('YAML')) {
      return '設定ファイルの形式が正しくありません。YAMLの構文を確認してください。';
    }

    // ネットワークエラー
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return 'ネットワークエラーが発生しました。インターネット接続を確認してください。';
    }

    return error.message;
  }

  /**
   * Delay execution
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get error statistics
   * @returns {Object} Error and warning counts
   */
  getStats() {
    return {
      errors: this.errorCount,
      warnings: this.warningCount,
      hasErrors: this.errorCount > 0,
      hasWarnings: this.warningCount > 0
    };
  }

  /**
   * Reset error statistics
   */
  reset() {
    this.errorCount = 0;
    this.warningCount = 0;
    this.context = '';
  }

  /**
   * Create a safe wrapper for file operations
   * @param {Object} fs - File system object (fs-extra)
   * @returns {Object} Wrapped file system object
   */
  createSafeFileSystem(fs) {
    const errorHandler = this;
    
    return {
      async readFile(filePath, encoding = 'utf8') {
        return errorHandler.safeExecute(
          () => fs.readFile(filePath, encoding),
          `reading file ${filePath}`,
          {
            fallback: () => {
              throw new Error(`ファイルを読み込めませんでした: ${filePath}`);
            }
          }
        );
      },

      async writeFile(filePath, content) {
        return errorHandler.safeExecute(
          () => fs.writeFile(filePath, content),
          `writing file ${filePath}`,
          {
            retries: 2,
            fallback: () => {
              throw new Error(`ファイルを書き込めませんでした: ${filePath}`);
            }
          }
        );
      },

      async ensureDir(dirPath) {
        return errorHandler.safeExecute(
          () => fs.ensureDir(dirPath),
          `creating directory ${dirPath}`,
          {
            retries: 1
          }
        );
      },

      async copy(src, dest) {
        return errorHandler.safeExecute(
          () => fs.copy(src, dest),
          `copying ${src} to ${dest}`,
          {
            retries: 2,
            timeout: 60000 // 1 minute for large copies
          }
        );
      },

      async pathExists(filePath) {
        return errorHandler.safeExecute(
          () => fs.pathExists(filePath),
          `checking existence of ${filePath}`,
          {
            suppressError: true,
            fallback: () => false
          }
        );
      }
    };
  }
}