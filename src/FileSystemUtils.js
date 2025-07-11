import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';

/**
 * ファイルシステム操作のユーティリティクラス
 */
export class FileSystemUtils {
  constructor() {
    this.backupSuffix = '.backup';
  }

  /**
   * ディレクトリが存在することを確認し、存在しない場合は作成する
   * @param {string} dirPath - ディレクトリパス
   */
  async ensureDir(dirPath) {
    try {
      await fs.ensureDir(dirPath);
    } catch (error) {
      throw new Error(`ディレクトリの作成に失敗しました: ${dirPath} - ${error.message}`);
    }
  }

  /**
   * ファイルやディレクトリが存在するかチェックする
   * @param {string} filePath - ファイルパス
   * @returns {boolean} 存在する場合true
   */
  async exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ファイルのバックアップを作成する
   * @param {string} filePath - ファイルパス
   * @returns {string} バックアップファイルのパス
   */
  async createBackup(filePath) {
    if (!(await this.exists(filePath))) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}${this.backupSuffix}-${timestamp}`;
    
    try {
      await fs.copy(filePath, backupPath);
      console.log(`✅ バックアップを作成しました: ${backupPath}`);
      return backupPath;
    } catch (error) {
      throw new Error(`バックアップの作成に失敗しました: ${error.message}`);
    }
  }

  /**
   * ディレクトリを再帰的にコピーする
   * @param {string} srcPath - コピー元パス
   * @param {string} destPath - コピー先パス
   * @param {Object} options - オプション
   */
  async copyDirectory(srcPath, destPath, options = {}) {
    const { overwrite = false, filter = null } = options;

    try {
      await fs.copy(srcPath, destPath, {
        overwrite,
        filter: filter || (() => true)
      });
      console.log(`✅ ディレクトリをコピーしました: ${srcPath} → ${destPath}`);
    } catch (error) {
      throw new Error(`ディレクトリのコピーに失敗しました: ${error.message}`);
    }
  }

  /**
   * ファイルを安全に書き込む（一時ファイルを使用）
   * @param {string} filePath - ファイルパス
   * @param {string} content - 書き込み内容
   * @param {string} encoding - エンコーディング
   */
  async writeFileSafe(filePath, content, encoding = 'utf8') {
    const tempPath = `${filePath}.tmp`;
    
    try {
      // 一時ファイルに書き込み
      await fs.writeFile(tempPath, content, encoding);
      
      // 元のファイルが存在する場合はバックアップを作成
      if (await this.exists(filePath)) {
        await this.createBackup(filePath);
      }
      
      // 一時ファイルを正式なファイルに移動
      await fs.move(tempPath, filePath);
      
    } catch (error) {
      // 一時ファイルのクリーンアップ
      if (await this.exists(tempPath)) {
        await fs.remove(tempPath);
      }
      throw new Error(`ファイルの書き込みに失敗しました: ${error.message}`);
    }
  }

  /**
   * ファイルを読み込む
   * @param {string} filePath - ファイルパス
   * @param {string} encoding - エンコーディング
   * @returns {string} ファイルの内容
   */
  async readFile(filePath, encoding = 'utf8') {
    try {
      return await fs.readFile(filePath, encoding);
    } catch (error) {
      throw new Error(`ファイルの読み込みに失敗しました: ${filePath} - ${error.message}`);
    }
  }

  /**
   * ディレクトリの内容を一覧取得する
   * @param {string} dirPath - ディレクトリパス
   * @param {Object} options - オプション
   * @returns {Array<string>} ファイル・ディレクトリ一覧
   */
  async listDirectory(dirPath, options = {}) {
    const { recursive = false, filesOnly = false, pattern = null } = options;

    try {
      if (recursive || pattern) {
        const globPattern = pattern || (recursive ? '**/*' : '*');
        const fullPattern = path.join(dirPath, globPattern);
        const files = await glob(fullPattern, { 
          windowsPathsNoEscape: true,
          nodir: filesOnly 
        });
        return files.map(file => path.relative(dirPath, file));
      } else {
        const items = await fs.readdir(dirPath);
        if (filesOnly) {
          const files = [];
          for (const item of items) {
            const itemPath = path.join(dirPath, item);
            const stat = await fs.stat(itemPath);
            if (stat.isFile()) {
              files.push(item);
            }
          }
          return files;
        }
        return items;
      }
    } catch (error) {
      throw new Error(`ディレクトリの読み込みに失敗しました: ${dirPath} - ${error.message}`);
    }
  }

  /**
   * ファイルまたはディレクトリを削除する
   * @param {string} targetPath - 削除対象のパス
   * @param {Object} options - オプション
   */
  async remove(targetPath, options = {}) {
    const { backup = false } = options;

    try {
      if (backup && await this.exists(targetPath)) {
        await this.createBackup(targetPath);
      }

      await fs.remove(targetPath);
      console.log(`✅ 削除しました: ${targetPath}`);
    } catch (error) {
      throw new Error(`削除に失敗しました: ${targetPath} - ${error.message}`);
    }
  }

  /**
   * ファイルの情報を取得する
   * @param {string} filePath - ファイルパス
   * @returns {Object} ファイル情報
   */
  async getFileInfo(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return {
        path: filePath,
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime
      };
    } catch (error) {
      throw new Error(`ファイル情報の取得に失敗しました: ${filePath} - ${error.message}`);
    }
  }

  /**
   * ディレクトリのサイズを計算する
   * @param {string} dirPath - ディレクトリパス
   * @returns {number} サイズ（バイト）
   */
  async calculateDirectorySize(dirPath) {
    try {
      const files = await glob(path.join(dirPath, '**/*'), { 
        windowsPathsNoEscape: true,
        nodir: true 
      });
      
      let totalSize = 0;
      for (const file of files) {
        const stats = await fs.stat(file);
        totalSize += stats.size;
      }
      
      return totalSize;
    } catch (error) {
      throw new Error(`ディレクトリサイズの計算に失敗しました: ${dirPath} - ${error.message}`);
    }
  }

  /**
   * ファイルをバッチで処理する
   * @param {string} dirPath - ディレクトリパス
   * @param {string} pattern - ファイルパターン
   * @param {Function} processor - 処理関数
   */
  async batchProcessFiles(dirPath, pattern, processor) {
    try {
      const files = await glob(path.join(dirPath, pattern), { 
        windowsPathsNoEscape: true,
        nodir: true 
      });
      
      console.log(`📁 ${files.length} 個のファイルを処理します...`);
      
      const results = [];
      for (const file of files) {
        try {
          const result = await processor(file);
          results.push({ file, success: true, result });
          console.log(`✅ 処理完了: ${path.relative(dirPath, file)}`);
        } catch (error) {
          results.push({ file, success: false, error: error.message });
          console.error(`❌ 処理失敗: ${path.relative(dirPath, file)} - ${error.message}`);
        }
      }
      
      return results;
    } catch (error) {
      throw new Error(`バッチ処理に失敗しました: ${error.message}`);
    }
  }

  /**
   * ディレクトリを空にする
   * @param {string} dirPath - ディレクトリパス
   * @param {Object} options - オプション
   */
  async emptyDirectory(dirPath, options = {}) {
    const { backup = false } = options;

    try {
      if (backup) {
        await this.createBackup(dirPath);
      }

      await fs.emptyDir(dirPath);
      console.log(`✅ ディレクトリを空にしました: ${dirPath}`);
    } catch (error) {
      throw new Error(`ディレクトリの削除に失敗しました: ${dirPath} - ${error.message}`);
    }
  }

  /**
   * パスが安全かチェックする（ディレクトリトラバーサル対策）
   * @param {string} basePath - ベースパス
   * @param {string} targetPath - 対象パス
   * @returns {boolean} 安全な場合true
   */
  isSafePath(basePath, targetPath) {
    const resolvedBase = path.resolve(basePath);
    const resolvedTarget = path.resolve(basePath, targetPath);
    
    return resolvedTarget.startsWith(resolvedBase);
  }

  /**
   * 一時ディレクトリを作成する
   * @param {string} prefix - プレフィックス
   * @returns {string} 一時ディレクトリのパス
   */
  async createTempDir(prefix = 'book-formatter-') {
    const tempDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp', prefix));
    return tempDir;
  }

  /**
   * ファイルの内容を検索・置換する
   * @param {string} filePath - ファイルパス
   * @param {RegExp|string} searchPattern - 検索パターン
   * @param {string} replacement - 置換文字列
   * @returns {boolean} 置換が発生した場合true
   */
  async replaceInFile(filePath, searchPattern, replacement) {
    try {
      const content = await this.readFile(filePath);
      const newContent = content.replace(searchPattern, replacement);
      
      if (content !== newContent) {
        await this.writeFileSafe(filePath, newContent);
        return true;
      }
      
      return false;
    } catch (error) {
      throw new Error(`ファイル内容の置換に失敗しました: ${filePath} - ${error.message}`);
    }
  }

  /**
   * ディレクトリをコピーする（copyDirectoryのエイリアス）
   * @param {string} srcPath - コピー元パス
   * @param {string} destPath - コピー先パス
   * @param {Object} options - オプション
   */
  async copyDir(srcPath, destPath, options = {}) {
    return this.copyDirectory(srcPath, destPath, { ...options, overwrite: true });
  }
}