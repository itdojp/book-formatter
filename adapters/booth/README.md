# booth adapter

- 実装状態: implemented (`booth-plan-v1`)
- 入力: 標準book.yaml、選択paid edition、別free/sample edition、source.editions/booth.yaml
- 出力: `<slug>-<version>.zip`、商品説明、README、CHANGELOG、package manifest、共通manifest
- 実装Issue: [#101](https://github.com/itdojp/book-formatter/issues/101)

**計画ZIPのみです。実PDF/EPUBは0、販売・配布不可です。** `generated=false`と`ready_for_distribution=false`を維持し、実renderer/成果物検証は[#152](https://github.com/itdojp/book-formatter/issues/152)へ分離します。upload、販売登録、決済操作は行いません。

設定/schema、CLI、ZIP構造、full/sample分離、snapshot/owned-output境界、決定性と公開前gateは[commerce契約](../../docs/commerce.md)を参照してください。
共通CLIの`--out-dir`はtargetの親rootです（`dist` → `dist/booth`）。既存skeleton-only BOOTH利用時は新たにcommerce設定が必要になります。他targetは不変です。

共通開発規約は[Adapter開発契約](../README.md)を参照してください。
