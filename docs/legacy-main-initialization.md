# 旧オプションmain.jsの初期化境界

## 対象と目的

この契約は、formatter保守者と旧consumerの保守者向けです。`shared/assets/js/main.js`を明示的に読み込むページで、任意機能の同期的な初期化例外が、独立した後続機能の初期化を止めないようにします。[Issue #9](https://github.com/itdojp/book-formatter/issues/9)の有限な改善であり、JavaScriptによる停止をすべて防ぐものではありません。

現行の`shared/layouts/book.html` / `default.html`はこのfileを読み込みません。また、`shared/version.json`のmanaged assets一覧にも含まれません。今回の変更では標準layoutへ追加せず、component sync対象とversionも変更しません。標準のtheme、search、code-copyの例外処理を変更したとは扱いません。旧consumerへ自動配布する変更でもありません。

## 初期化の順序と失敗時の動作

| タイミング | 固定feature label | 機能 |
| --- | --- | --- |
| DOM ready後、即時 | `addStyles` | 既存の補助style追加 |
| 同上 | `initSmoothScrolling` | anchor click handler登録 |
| 100msのtimer | `addHeadingIds` | 既存方式での見出しID・anchor追加 |
| 200msのtimer、順次 | `generateTOC` | ページ内TOC生成 |
| 同上 | `handleExternalLinks` | 外部リンクの属性・icon追加 |
| 同上 | `enhanceImages` | 画像の補助属性・handler登録 |

各関数を個別の同期runnerで呼びます。例外時はその関数の処理を終え、残りの関数を予定の順序で試みます。全機能をまとめた一つのcatchではありません。timerの設定値と既存ID、見出しの生成方式は変更せず、retryや追加のJS bundleも導入しません。timer値は実行時刻の保証ではありません。

警告は、例えば次の固定書式です。

```text
[book-formatter/main] generateTOC: optional initialization failed; continuing.
```

feature名は呼出側の固定値です。例外object、stack、URL、本文由来の値をこの警告へ展開しません。機能の失敗を黙って成功扱いにせず、切り分け可能なfeature名を残します。調査時は、保守者が非公開情報を除いた再現fixtureとbrowserのdebuggerで原因を確認してください。

## 保証しないこと

- 初期化済みのDOM変更をtransactionとして巻き戻すこと。関数が途中で失敗すれば、その関数の部分変更は残り得ます。
- 後続機能の成功そのもの。後続の初期化を**試みる**契約であり、その機能の入力まで修復するものではありません。
- 後から呼ばれるevent handler、Promise、別のscriptの例外を捕捉すること。
- 無限loopや長い同期処理を中断すること、全engineでの性能や応答時間を保証すること。
- 不完全な見出しID・TOC構造・既存markupを修復すること。初期化失敗時にも必要なリンクや本文は、canonical HTML自体で成立させてください。

Issue #9の広い性能・ブラウザ互換の受け入れや、既存consumerへの導入判断は別に残します。読めることと、すべての補助機能が動作することを区別します。

## 検証

`tests/SharedDomSafety.test.js`で、6関数それぞれの失敗、全関数の失敗、正常系を、DOMContentLoaded待ちと即時初期化の双方で検査します。既存のDOM安全性検査は維持し、順序・timer値・一回だけの試行・固定警告・例外内容の非出力も確認します。

`npm run test:shared-dom-browser`は実Chromeで既存DOM回帰に加え、同じ16条件の有限fixtureを動かします。本文と既存ID・リンク、TOC、外部リンク属性、画像操作の独立性を確認します。fixtureは合成本文、予約domain、data画像のみで、外部ページへアクセスしません。これは全browser engineの認定や性能benchmarkではありません。

exact head、実行結果、失敗・skip・依存auditの独立blockerはPRへ記録します。単体/native回帰の成功で、監査失敗やrelease gateを免除しません。
