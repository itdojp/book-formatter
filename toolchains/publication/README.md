# Isolated publication dependency gate

## Status / scope

[Issue #156](https://github.com/itdojp/book-formatter/issues/156)の**依存評価専用**packageです。rootのNode20/22/24・依存・consumer pinを変更せず、Node **24.18.0**、Vivliostyle CLI **11.3.3**を別lockで固定します。npm workspaceへの自動組込みはありません。

**本番PDF/EPUB rendererではありません。** この依存gate自体はCLI build/preview/create、browser起動、Ghostscript、MuPDF変換、書籍/有料本文の入力、アップロードを行いません。独立した[#158の合成EPUB実生成gate](tests/epub/README.md)のみ、固定container内でCLI buildとEPUBCheckを実行します。plan-only adapterの`generated: false`を変更しません。一般書籍の実生成・出力漏えい・実機/権利/印刷所gateは[#152](https://github.com/itdojp/book-formatter/issues/152)に残ります。

## Installation and gates

専用checkoutのこのdirectoryから、Node24.18.0を使用します。

```bash
set -euo pipefail
npm ci --ignore-scripts
npm audit --audit-level=moderate
npm run test:wrapper
npm run test:offline
npm run licenses
```

install/auditだけはnpm registryへ接続します。`--ignore-scripts`を外さず、browser自動downloadやnative rebuildを追加しないでください。registry/cache通信とoffline fixture実行は別工程です。既存adaptersと同様、同じcheckoutのinstall/buildを並行実行しないでください。

`test:offline`はLinuxのuser/network namespaceとNode permissionを必須とします。namespaceが使えなければ**失敗**し、通常networkで再試行しません。親と異なるnetwork namespace、外部interfaceなし、toolchain配下だけのread、write/child process拒否を実測します。`env -i`で実行し、入力はcommit済み合成fixtureのみです。ブラウザに渡す前の任意source/config/asset loaderは未提供です。

`npm test`は開発者向け互換性単体実行であり、隔離probeをskipします。完了判定はCI同様`test:offline`（全17件、skip0）を必須とします。Node permissionは敵対的native addonや同一UIDプロセスに対する一般sandboxではありません。このgateの隔離を、将来のrenderer全体へそのまま適用できるとは主張しません。

CIはUbuntu22.04、既存系列のcheckout/setup-node Actions、10分timeoutです。Node24.18.0固定はtoolchainだけであり、root enginesを狭めません。

## Audit and override decisions (2026-09-15)

未変更CLI11.3.3の初期lockはhigh3/moderate10/critical0（npmの影響package数であり、独立advisory数ではない）。CLI最新は同versionで、上流の直接pinが未是正です。CLI8.14.1への自動major downgradeや`audit fix --force`を選ばず、次の4箇所だけを固定overrideしました。前後lockのpackage version差分も4件だけです。

| Dependency path | Before → pinned | Primary source / compatibility |
| --- | --- | --- |
| VFM → remark-parse → trim | 0.0.1 → 0.0.3 | [ReDoS advisory](https://github.com/advisories/GHSA-w5p7-h5w8-2hfq)。同CommonJS API、短い空白/Markdown構文fixtureを比較。長大ReDoS入力を旧版へ渡さない |
| VFM → refractor → PrismJS | 1.27.0 → 1.30.0 | [DOM clobbering advisory](https://github.com/advisories/GHSA-x7hr-w5r2-h6wg)、[release](https://github.com/PrismJS/prism/releases/tag/v1.30.0)。JS/CSS/HTML/JSONのhighlight HTML比較。browser DOM実行はしない |
| CLI / VFM / plugins → Valibot | 1.2.0 → 1.4.2 | [record/flatten advisory](https://github.com/advisories/GHSA-5qjj-4xww-7phc)。VFM設定/schema合成/metadataとCLIの固定schema chunkを検査。継承property名3件のerror flattenも直接検査 |
| press-ready → uuid | 8.3.2 → 11.1.1 | [bounds advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)、[11.1.1 backport](https://github.com/uuidjs/uuid/releases/tag/v11.1.1)。CommonJS exportを維持する版を選び、実consumerの`require('uuid').v4()`とmodule import、v5 boundsを検査。CLI直接uuid14は変更しない |

是正後`npm audit --audit-level=moderate`は全severity **0**。これは検査時点のregistry advisory結果であり、未知脆弱性・CLI renderer全体の安全証明ではありません。CLIの内部schema chunkは11.3.3へ明示固定した検査用importです。上流更新時はchunk/API/overrideの要否を再監査します。任意のユーザーconfigをimport/evalする機能はありません。

### Golden fixture provenance

5件の合成corpus（日本語構造/脚注/表/コード、metadata、参照link、言語別code、空白/list）を未変更の同CLI/VFM closureで、network namespace・read permission下でHTML化してbaselineを作成しました。fixtureは短く、外部script/asset/実データを持ちません。是正後の全HTML bytes一致、marker/tag/読順、再実行の一致を検証します。任意Markdown互換性を証明するものではありません。

- 元lock SHA-256: `3eff6960f62df98cc73967c404dbc934e9454838c49bdf42b197bb2aa4d4bf3a`
- corpus SHA-256: `8fc2fd0090e2484528c2faa401ded8f84c4b2b63c4c9dc08261b4e74b2343407`
- golden SHA-256: `ecacac558ef44776c3e69b5587dd859988dc9bd1dcdea15b620fbda5bb09f969`
- renderer関数はVFM2.7.2 `stringify(markdown, {partial:false, language:'ja', title:'Synthetic fixture'})`。本packageの同じテストコードから呼びます。

### Measured installation cost

Linux / Node24.18.0、既存workspace npm cache利用、install scriptなし。初期18.44秒 / peak RSS474396KiB / node_modules259MiB、是正後14.33秒 / peak RSS678164KiB / 260MiB、いずれも679packages追加。cold-cache比較でもrender benchmarkでもありません。lock inventoryは他OS optional packageを含む722entryです。

## License inventory and release limits

[`license-inventory.json`](license-inventory.json)はlock全entry（optional各OSを含む）を再現する機械inventoryです。lockのlicenseが空のcli-table0.3.11 / format0.2.2 / not0.1.0 / rechoir0.6.2 / trim0.0.3は、配布packageのLICENSE/LICENCE/Readme License節またはlegacy licenses[]を個別確認しました。未知versionの空licenseは失敗します。生成は`node tests/licenses.mjs`、CIで比較します。

MIT530、ISC101、Apache-2.0 34、BlueOak-1.0.0 16、MPL-2.0 12、BSD-2/3各7、0BSD5、AGPL-3.0 3、その他各1（詳細inventory）。CLIのAGPL-3.0とMuPDFのAGPL-3.0-or-later、font/ICC等を含む将来のtoolchain再配布条件は別途確認が必要です。package自身のMIT表記を依存全体へ適用しません。inventoryは書籍成果物の権利/販売承認、法的助言、完全な再配布noticeの代用ではありません。

## Handoff to real rendering

#152では固定browser/fonts/EPUBCheck、OS/container境界、edition projection、外部asset/任意JS拒否、PDF/EPUB内の可視/不可視データ、決定性を実検証してください。Node child-process権限が必要なbrowserと本テストを混同しないこと。Kindle Previewer対応OS・E Ink/tablet・印刷所要求・表紙/本文権利は実証なしに完了にしません。

wrapperは名前空間不変・unshare失敗・親namespace取得失敗/空値・子namespace取得失敗/空値の6つをcommand doubleで直接拒否検証します（実隔離probeの代用ではありません）。内側bashでもerrexit/nounset/pipefailを明示し、namespace比較失敗後にNodeを開始しません。Node engineはmajorだけでなく`>=24.18.0 <25`全体を検査します。
