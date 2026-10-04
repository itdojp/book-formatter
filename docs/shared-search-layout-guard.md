# Shared search の有限な統合検査

対象読者は、legacy shared `search.js` を採用する公開書籍の保守担当者です。
目的は、検索結果の置換が必須の入力・本文を削除する配置と、最小検索長に
満たない入力制限を、実際にレンダリングされた DOM 上で検出することです。
検索 asset の安全な文字列描画だけでは、consumer の配置までは保証できません。

## 責任の分離

| 段階 | 必須の確認 | それだけでは証明できないこと |
| --- | --- | --- |
| source | 監査済み formatter SHA、asset digest、選択された layout/include、変更 allowlist | Liquid 分岐後の DOM、CSS・入力操作 |
| build | consumer の正規 renderer で root と代表章を生成し、使用された検索 asset とリンクを確認 | ブラウザの DOM 修復、入力制約、動的書換え |
| browser | 下記 preflight を実 Document に実行し、実入力・検索後の本文保持・操作性を確認 | 任意の HTML/CSS/JS、未選択の route、後から追加される script |

source の regex 検査や HTTP 200 を、後段の代わりにしません。
HTML/Liquid/CSS を Python や小さな DOM mock で再実装しません。
この guard は通常の `npm test` の代わりでも、runtime の防御機構でもありません。

## API / contract 1.0.0

`src/SharedSearchLayoutGuard.js` の `inspectSharedSearchDocument(document)` は、
検索 asset を選択済みの信頼できる consumer 検証 harness 向けの read-only 関数です。
Document や要素を変更せず、通信も行いません。新しい dependency は不要です。
Browser automation 側の依存は consumer の既存の監査済みツールを使います。
formatter の `npm ci` が Playwright を追加するわけではありません。

返却値は `contractVersion`、`minimumQueryLength`、`passed`、
`selectorCounts`、順序が一定の `findings` です。
各 finding は `code`、`selector`、`message` を持ちます。
Document API のない入力は例外となり、成功へ読み替えません。

有限の必須条件:

1. `#search-input`、`#search-results`、`.page-content` がそれぞれ一つ。
2. 入力は text/search 型の input。readonly・disabled は不可。
   disabled fieldset の影響もブラウザの `:disabled` 判定を使う。
3. ネイティブ `maxLength` が未制限（`-1`）または `2` 以上。
   生の属性文字列を独自に数値解釈しない。
4. results は input/content と同一でも、その祖先でもない。
   `replaceChildren()` が入力・本文を消してしまう配置を拒否する。

結果の code は `selector-count`、`input-type`、`input-not-editable`、
`query-length`、`results-remove-input`、`results-remove-content` です。
最小検索長は現在の shipped asset の `2` に対応します。変更時は guard、
native fixture、既存 consumer を再監査します。version の一致だけで互換を推測しません。

### consumer harness への組込み例

既存の Playwright harness で、信頼できる生成ページを開いた後に使う断片です。
URL、browser 起動、renderer、asset 固定、allowlist は呼出し側が所有します。
`page` はその harness が作成した実ページであり、ここで任意 URL を自動取得しません。

```javascript
import assert from 'node:assert/strict';
import { inspectSharedSearchDocument } from './formatter/src/SharedSearchLayoutGuard.js';

const report = await page.evaluate(`(${inspectSharedSearchDocument.toString()})(document)`);
assert.equal(report.passed, true, JSON.stringify(report));
// 成功後も実入力、本文保持、click/Escape、desktop/mobile を別途確認する。
```

関数は自己完結しています。評価する文字列は監査済み module 由来の関数と
固定の呼出しだけに限定し、検索語や公開ページの文字列をコードに混ぜません。

finding または例外があれば検索操作前に停止します。検証対象に検索を提供しない
page がある場合は、source manifest で対象外を明示し、欠落を自動成功にしません。
診断が空でも、要素の可視性・重なり・font・focus・任意の script の副作用は
別途確認が必要です。悪意あるページの実行 sandbox ではありません。

## 回帰検証と次 batch の採用条件

`npm test` は診断・シリアライズ・fixture/wiring を確認します。
`npm run test:shared-search-layout-browser` は実 Chrome を必須とし、
synthetic offline fragment に実 `search.js` と guard を使います。
依存不足・browser 不在・途中終了は失敗であり skip しません。

- 祖先配置と `maxlength=1` は、拒否に加えて故障が実 DOM / 実キー入力で再現することを確認。
- 安全な兄弟配置、無制限、`maxlength=2/64`、text input は二文字入力と結果表示、本文保持、Escape を確認。
- 欠落・重複、readonly、disabled fieldset、不正 input type は有限の negative fixture。
- guard 前後の DOM 不変と、同一 Document での診断順序の決定性を確認。

negative control だけは inert fixture 内で意図的に guard を迂回して故障を再現します。
consumer harness では迂回しません。外部通信を要求する fixture は追加しません。

次の検索 rollout（#165）では、formatter/source SHA・consumer base SHA・実 asset
digest・root/代表章・renderer・browser/viewport・guard 結果・検索操作後の本文保持を
記録します。まず代表 consumer 最大二冊で、source/build/public の差分を分離して確認。
consumer 固有 layout の不適合は別 PR で直し、guard を弱めて採用しません。
header #115、sidebar #116、QA formatter pin #297、書籍本文の変更とは分離します。

非目標は、全 HTML5/CSS/Liquid の完全性、任意 JS の安全性、すべての将来 layout の
互換性、screen reader 全機種の保証です。未使用の特殊構文の無制限な列挙は行わず、
実 consumer またはこの有限契約の違反を次の対応判断に使います。
