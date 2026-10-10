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

`npm test`は開発者向け互換性単体実行であり、隔離probeをskipします。完了判定はCI同様`test:offline`（全30件、skip0）を必須とします。Node permissionは敵対的native addonや同一UIDプロセスに対する一般sandboxではありません。このgateの隔離を、将来のrenderer全体へそのまま適用できるとは主張しません。

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

### Scoped DOMPurify patch (2026-10-02 JST, #174)

前日のaudit0は本日の結果へ持ち越しません。DOMPurify3.4.13–3.4.15に
[IN_PLACEとafterSanitize hookのadvisory](https://github.com/advisories/GHSA-p98j-92pf-mc4p)
が追加され、固定CLI11.3.3のclosureでlow2（DOMPurifyと依存するCLI）、high/moderate/critical0を検出しました。
上流CLIのexact pin3.4.13をlock-only更新では是正できないため、既存4overrideを維持したまま
`@vivliostyle/cli → dompurify: 3.4.16`を5件目の限定overrideとして追加します。
CLI/Node/renderer更新や`npm audit fix --force`によるdowngradeは行いません。

実際のCLI依存解決、短いHTML sanitation6例、2つのafterSanitize hookによるdetached subtreeの
inert attribute除去を直接検証します。event実行、外部resource、実書籍は使用しません。
既存5VFM goldenは更新せずbyte一致を要求します。隔離17既存testに3testを加え、必須offline gateは
全20件・skip0です。license inventoryと固定lock attestationのみを実lockに同期し、他のfixture/image
pinsやgoldenを変更しません。auditの全severity結果は再実行時点を記録し、renderer全体の
到達性・未知脆弱性・書籍販売可能性の証明とは扱いません。

### Scoped cache dependency update (2026-10-04 JST, #174)

公式配布の`http-cache-semantics`を4.2.0から4.3.0へ、既存の`^4.1.1`範囲内で更新します。
追加overrideやCLI/Node更新はありません。licenseはBSD-2-Clauseのままです。
配布物のSRIと差分を確認し、lockに対応するlicense versionとlock SHA attestationを同期します。
4.3.0には[上流PR59](https://github.com/kornelski/http-cache-semantics/pull/59)の
Vary wildcard/own-header修正が含まれます。直接検査8例では旧4.2.0の4例が不一致、4.3.0は全例一致です。

[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)は確認時点で
affected `<=4.2.0` / patched `None`のままですが、
[メンテナーはCVEの前提に異議を示しています](https://github.com/kornelski/http-cache-semantics/pull/60#issuecomment-5975833081)。
撤回済みとも、4.3.0がすべての再利用問題を修正したとも扱いません。
直接ライブラリ診断では、4.3.0にも応答`no-cache`と`max-stale`/stale fallbackを組み合わせた
再利用判定が残ります。[RFC9111の再検証要件](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.4)
に関する懸念と、利用者間の秘密流出の実証は別です。auditの範囲外になったことだけで
安全性を証明せず、この制約を一般用途へ持ち越します。

対象を本gateに限る根拠は、固定の合成入力、remote themeなし、秘密/home/shared cache非持込み、
外部networkなしの既存実行契約です。CLIのテーマ取得経路はarborist/registry-fetchを介した
make-fetch-happen15.0.6のprivate policyですが、`shared:false`自体は利用者分離機構ではありません。
複数の認証主体でcache directoryを共有する一般CLI運用は未検証であり、本gateの保証対象外です。
install/audit時のregistry接続と、offline実行を混同しません。npm自身の内蔵依存を更新したとも主張しません。

実CLIからの依存解決、Vary/serialization/status、実private wrapperのfresh/stale/no-cache/
Vary/304/503判定を4つの必須offline testで検査します。Request/Responseはメモリ上の合成値で、
fetchやcache I/Oを実行しません。実通信例外からのconsumer独自fallbackを含む全CLI経路の
検証ではなく、将来のremote theme/一般書籍入力では再監査が必要です。
既存20testと5つのVFM goldenは保持し、必須offlineは24件・skip0です。
固定EPUB2回生成・隔離・EPUBCheck・否定試験とexact-head reviewを省略せず、
監査除外やgate免除は追加しません。

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


### 2026-10-08 source-map-js audit correction (#182)

The isolated lock now selects official `source-map-js@1.2.2` within PostCSS's
existing range, addressing GHSA-68fv-2mgg-jv7q. Its section-offset validation
and bounded caller compatibility are tested; the license inventory and EPUB
lock digest are regenerated. Renderer/Node/image/EPUBCheck versions and the
moderate audit threshold are unchanged. Actual synthetic EPUB re-execution,
not just lock preparation, is required before acceptance.


### Scoped Handlebars patch (2026-10-10 JST, #184)

PR183 merge後のfresh auditで、CLI11.3.3のexact `handlebars@4.7.9`に
Critical1 / Moderate1（依存CLIへの伝播を含む影響package数）を検出しました。
[4.7.10公式release](https://github.com/handlebars-lang/handlebars.js/releases/tag/v4.7.10)と
[AST validation](https://github.com/advisories/GHSA-8r5x-fm3f-whwj)、
[context own-property](https://github.com/advisories/GHSA-p8wg-vrv2-v86f)、
[precompiled output escaping](https://github.com/advisories/GHSA-xw65-4hp5-5hc7)の
3advisoryを確認し、CLI配下のみ`handlebars:4.7.10`を追加overrideします。
当日時点のCLI latestは11.3.3のままです。tarballのSHA512 SRIを検証し、配布sourceの
AST/Visitor validation、context/partial処理、escaping、有限iterationの変更を確認しました。
lockのpackage version変更はHandlebars1件だけで、MIT licenseとEPUB lock digestを同期します。
CLI、Node、root依存、image、EPUBCheck、audit moderate閾値、既存goldenは変更しません。

実CLI11.3.3の`scaffold-DlBNHRiW.js` export `format`を使い、9helper、`compile`の
`noEscape:true`、条件分岐、有限array/Set、空白処理を検査します。固定chunkへの依存は
検査限定で、CLI更新時は再監査が必要です。scaffold command、remote template取得、
任意config読込やfile出力は呼びません。`noEscape`は既存の文字列生成仕様であり、
出力のHTML安全性や任意templateの信頼境界ではありません。

CLI配布JSからはHandlebars `precompile`直接呼出しを確認できませんでした。
追加の短いprecompile/AST/own-property/partial検査は依存APIの回帰確認であり、
formatterからのexploit到達性の実証ではありません。悪性コード、巨大入力、browser実行、
precompiled codeのevalは使いません。4.7.10の`#each`はiterableをlazyに読むため、
render中に変更するcollectionの一般互換性は保証しません。本gateでは変更しない有限値のみです。

新規3testを既存27testに加え、必須offlineは30件・skip0、wrapperは別6件です。
5VFM goldenと、hosted CIでの2実合成EPUB/EPUBCheck/同等性gateを維持します。
実書籍入力・販売承認・consumer pin採用とは別工程であり、fresh audit成功は時点付き観測です。
