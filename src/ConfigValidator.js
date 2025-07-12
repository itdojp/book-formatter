/**
 * 設定ファイルのバリデーション機能
 */
export class ConfigValidator {
  constructor() {
    this.requiredFields = [
      'title',
      'description',
      'author'
    ];
    
    this.optionalFields = [
      'version',
      'language',
      'structure',
      'repository',
      'output',
      'theme'
    ];
  }

  /**
   * 設定オブジェクトをバリデーションする
   * @param {Object} config - 設定オブジェクト
   * @throws {Error} バリデーションエラー
   */
  validate(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('設定ファイルが正しくありません');
    }

    // 必須フィールドのチェック
    this.validateRequiredFields(config);
    
    // データ型のチェック
    this.validateDataTypes(config);
    
    // 構造のチェック
    this.validateStructure(config);
    
    // ナビゲーション設定のチェック
    this.validateNavigation(config);
    
    // リポジトリ情報のチェック
    this.validateRepository(config);
    
    console.log('✅ 設定ファイルのバリデーションが完了しました');
  }

  /**
   * 必須フィールドをチェックする
   * @param {Object} config - 設定オブジェクト
   */
  validateRequiredFields(config) {
    const missingFields = [];
    
    for (const field of this.requiredFields) {
      if (!(field in config) || !config[field]) {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      throw new Error(`必須フィールドが不足しています: ${missingFields.join(', ')}`);
    }
  }

  /**
   * データ型をチェックする
   * @param {Object} config - 設定オブジェクト
   */
  validateDataTypes(config) {
    // 文字列フィールドのチェック
    const stringFields = ['title', 'description', 'author', 'version', 'language'];
    for (const field of stringFields) {
      if (config[field] && typeof config[field] !== 'string') {
        throw new Error(`${field} は文字列である必要があります`);
      }
    }

    // タイトルの長さチェック
    if (config.title && config.title.length > 100) {
      throw new Error('タイトルは100文字以内で入力してください');
    }

    // 説明の長さチェック
    if (config.description && config.description.length > 500) {
      throw new Error('説明は500文字以内で入力してください');
    }

    // バージョン形式のチェック
    if (config.version && !this.isValidVersion(config.version)) {
      throw new Error('バージョンは semantic versioning 形式で入力してください (例: 1.0.0)');
    }
  }

  /**
   * 構造設定をチェックする
   * @param {Object} config - 設定オブジェクト
   */
  validateStructure(config) {
    if (!config.structure) return;

    const structure = config.structure;

    // 章の設定チェック
    if (structure.chapters) {
      if (!Array.isArray(structure.chapters)) {
        throw new Error('chapters は配列である必要があります');
      }

      for (const [index, chapter] of structure.chapters.entries()) {
        this.validateChapter(chapter, index + 1);
      }
    }

    // 付録の設定チェック
    if (structure.appendices) {
      if (!Array.isArray(structure.appendices)) {
        throw new Error('appendices は配列である必要があります');
      }

      for (const [index, appendix] of structure.appendices.entries()) {
        this.validateAppendix(appendix, index + 1);
      }
    }
  }

  /**
   * 章設定をチェックする
   * @param {Object} chapter - 章オブジェクト
   * @param {number} index - 章の番号
   */
  validateChapter(chapter, index) {
    if (!chapter.id) {
      throw new Error(`章 ${index}: id が必要です`);
    }

    if (!chapter.title) {
      throw new Error(`章 ${index}: title が必要です`);
    }

    if (typeof chapter.id !== 'string') {
      throw new Error(`章 ${index}: id は文字列である必要があります`);
    }

    if (typeof chapter.title !== 'string') {
      throw new Error(`章 ${index}: title は文字列である必要があります`);
    }

    // IDの形式チェック (英数字とハイフンのみ)
    if (!/^[a-z0-9-]+$/.test(chapter.id)) {
      throw new Error(`章 ${index}: id は英小文字、数字、ハイフンのみ使用できます`);
    }
  }

  /**
   * 付録設定をチェックする
   * @param {Object} appendix - 付録オブジェクト
   * @param {number} index - 付録の番号
   */
  validateAppendix(appendix, index) {
    if (!appendix.id) {
      throw new Error(`付録 ${index}: id が必要です`);
    }

    if (!appendix.title) {
      throw new Error(`付録 ${index}: title が必要です`);
    }

    if (typeof appendix.id !== 'string') {
      throw new Error(`付録 ${index}: id は文字列である必要があります`);
    }

    if (typeof appendix.title !== 'string') {
      throw new Error(`付録 ${index}: title は文字列である必要があります`);
    }

    // IDの形式チェック
    if (!/^[a-z0-9-]+$/.test(appendix.id)) {
      throw new Error(`付録 ${index}: id は英小文字、数字、ハイフンのみ使用できます`);
    }
  }

  /**
   * リポジトリ情報をチェックする
   * @param {Object} config - 設定オブジェクト
   */
  validateRepository(config) {
    if (!config.repository) return;

    const repo = config.repository;

    if (repo.url && typeof repo.url !== 'string') {
      throw new Error('repository.url は文字列である必要があります');
    }

    if (repo.url && !this.isValidUrl(repo.url)) {
      throw new Error('repository.url は有効なURL形式である必要があります');
    }

    if (repo.branch && typeof repo.branch !== 'string') {
      throw new Error('repository.branch は文字列である必要があります');
    }
  }

  /**
   * バージョン形式が有効かチェックする
   * @param {string} version - バージョン文字列
   * @returns {boolean} 有効な場合true
   */
  isValidVersion(version) {
    const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
    return semverRegex.test(version);
  }

  /**
   * URL形式が有効かチェックする
   * @param {string} url - URL文字列
   * @returns {boolean} 有効な場合true
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * バリデーションの詳細情報を取得する
   * @param {Object} config - 設定オブジェクト
   * @returns {Object} バリデーション結果
   */
  getValidationDetails(config) {
    const results = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      this.validate(config);
    } catch (error) {
      results.isValid = false;
      results.errors.push(error.message);
    }

    // 警告の追加
    if (config.structure && !config.structure.chapters) {
      results.warnings.push('章の設定がありません');
    }

    if (!config.version) {
      results.warnings.push('バージョンが設定されていません');
    }

    if (!config.repository) {
      results.warnings.push('リポジトリ情報が設定されていません');
    }

    return results;
  }

  /**
   * ナビゲーション設定をバリデーションする
   * @param {Object} config - 設定オブジェクト
   */
  validateNavigation(config) {
    if (!config.navigation) {
      // ナビゲーション設定がない場合は自動生成するため、エラーではない
      return;
    }

    const navigation = config.navigation;

    // order が設定されている場合の検証
    if (navigation.order) {
      if (!Array.isArray(navigation.order)) {
        throw new Error('navigation.order は配列である必要があります');
      }

      // 重複チェック
      const uniquePaths = new Set(navigation.order);
      if (uniquePaths.size !== navigation.order.length) {
        throw new Error('navigation.order に重複したパスが含まれています');
      }

      // 空の値のチェック
      const invalidPaths = navigation.order.filter(path => !path || typeof path !== 'string');
      if (invalidPaths.length > 0) {
        throw new Error('navigation.order に無効なパスが含まれています');
      }

      // パスの形式チェック
      const invalidFormat = navigation.order.filter(path => {
        // パスは英数字、ハイフン、スラッシュ、アンダースコアのみ許可
        return !/^[a-zA-Z0-9\-_/]+$/.test(path);
      });
      
      if (invalidFormat.length > 0) {
        throw new Error(`navigation.order に無効な形式のパスが含まれています: ${invalidFormat.join(', ')}`);
      }

      console.log(`✅ ナビゲーション設定を検証しました: ${navigation.order.length}ページ`);
    }
  }
}