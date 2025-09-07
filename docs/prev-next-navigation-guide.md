# 前へ/次へ（Bottom Navigation）設計ガイドと落とし穴

本ガイドは、book-formatter v3 における下部ナビゲーション（前へ/次へ/目次へ）の設計と、運用上の注意点をまとめたものです。

## 1. 基本方針
- 参照順の定義は以下の優先順位で行います。
  1) `docs/_data/navigation.yml` の配列（`introduction` → `chapters` → `additional/resources` → `appendices` → `afterword`）
  2) `layout: book` かつ `order` を持つページの `order` 順
  3) URLグループごとのフォールバック（`/introduction/`, `/chapters/`, `/additional|/resources/`, `/appendices/`, `/afterword/`）
- 最も確実なのは、`docs/_data/navigation.yml` を整備することです。章/付録の順序・タイトル・パスを明示的に定義してください。

## 2. よくある落とし穴（プロジェクトPages）
- `docs/index.md` に `permalink: /` を設定しないでください。プロジェクトPages（`baseurl` あり）では、トップは `/<repo>/` に出力される必要があります。`permalink: /` があるとルート`/`に出力され、`/<repo>/` が 404 になります。
- `baseurl` は `_config.yml` に設定します。引用符で囲んでも動作しますが、ワークフロー等で正しく扱うためにはYAMLとして解釈される前提で記述するのが望ましいです。

## 3. パス設計の注意
- 章の実体が `docs/chapters/*` でなく `docs/src/chapter-*/*` のような構成でも問題はありません。その場合は `navigation.yml` で実パスに合わせて `path` を `/src/chapter-1/` のように指定してください。
- `appendices` 直下に章ディレクトリが無い場合はトップ（例: `/appendices/`、または `/src/appendices/`）を `path` に置く方法もあります。

## 4. 運用（推奨）
- 週次のリンク検証ワークフローを導入し、Pagesと下部ナビの動作を自動チェックします（200以外ならFail）。
- CIで検出した404は、`navigation.yml` の生成/補修PRで即応します。

## 5. 参考
- 共通インクルード: `docs/_includes/page-navigation.html`
- 統一ガイド: `docs/book-format-unification-guide.md`

