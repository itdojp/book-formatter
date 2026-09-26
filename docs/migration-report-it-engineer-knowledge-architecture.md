# Portal pilot適用可否レポート

監査日: 2026-09-26（Asia/Tokyo）。対象は [Issue #104](https://github.com/itdojp/book-formatter/issues/104)。
保守担当者が、標準書籍adapterを適用できる対象と、別設計が必要なカタログを区別するための記録です。

## 結論と今回の到達点

**現行portalをそのまま `web-mdbook` に渡す移行は不適合です。**
入力契約の拒否を確認したうえで、既存Jekyllカタログを変更せず維持します。
標準sampleのbuild成功を、portalの移行成功・機能同等性・公開承認とは扱いません。

| 対象 | 結果 | 意味 |
| --- | --- | --- |
| portal → formatter dry-run | exit 1: `book.yaml does not exist: book.yaml` | 標準書籍metadataがない。出力なし |
| portal → mdBook直接build | exit 101: `src/SUMMARY.md` を読めない | mdBook projectではない。出力なし |
| portal既存Jekyll | build・既存gate・baseline表示成功 | 現行カタログは維持できる |
| formatter標準sample（対照） | build・再生成・visibility・responsive成功 | 固定toolchainの対照確認のみ |

今回は正本をbookへ変換する実装、after画像、sidebar改善、公開先切替を行っていません。
#104の移行条件は未完了として残します。失敗を `|| true` で成功扱いにせず、期待した拒否と
実行基盤の故障を分けて記録しました。

## 固定した入力と環境

- portal: [`c48426e550f13ae41de0fad213896d420792914d`](https://github.com/itdojp/it-engineer-knowledge-architecture/tree/c48426e550f13ae41de0fad213896d420792914d)
- formatter runtime: [`3b2ecf0822e6f76fe6213fd0bd764e04f99f8aaf`](https://github.com/itdojp/book-formatter/tree/3b2ecf0822e6f76fe6213fd0bd764e04f99f8aaf)
- Linux x86_64、Node.js 22.22.2、Jekyll 4.4.1、portal Playwright 1.61.1、Chromium 149.0.7827.55。
- mdBook 0.5.4は[adapterの固定archive/digest契約](../adapters/web-mdbook/README.md#buildとレスポンシブ検証)に従い、新規取得・SHA-256検証後に実行。
- 既存dirty/non-main checkoutとは別のworkspace内clone/worktreeを使用。133 tracked filesの
  SHA-256を前後照合し、portal canonical差分0。private repositoryや書籍本文は取得していません。

成果物・ログは所有workspaceに保存し、npm/ブラウザーcacheを無断更新するための
ホスト設定変更、Pages設定変更、workflow dispatch、npm publishは行っていません。

## 現行構造と維持すべき契約

全133 tracked filesに `book.yaml`、`book.toml` はなく、root `theme/` もありません。
[package.json](https://github.com/itdojp/it-engineer-knowledge-architecture/blob/c48426e550f13ae41de0fad213896d420792914d/package.json)の
`private: true` はnpm配布設定です。GitHub repository自体がprivateという意味ではありません。

| 正本・実装 | 現在の責務 | 単純なMarkdown変換では失うもの |
| --- | --- | --- |
| `docs/_data/catalog.json` | 49レコード、7学習パス、前提関係、公開範囲 | ID集合・関係・公開範囲の単一正本 |
| `docs/_data/youtube.json` | 紹介動画とcatalogの対応 | 日英の動画・再生リスト導線と整合検査 |
| `docs/index.md`, `docs/books/index.html`, `docs/paths/index.html`, `docs/en/index.md` | Liquidでデータからreader viewを生成 | カード、絞込み、学習パス、日英同等性、JSなし表示 |
| `docs/_layouts/default.html` | inline CSS/JS、header/nav/main/footer、base path、canonical | navigation、skip link、表のoverflow境界、フィルター |
| `scripts/generate-catalog-derived.mjs`, `report-catalog-debt.mjs` | 派生文書と管理用debtの検証 | 生成差分検出とreader viewへの管理値流出防止 |
| `tests/e2e/` | 構造・axe・操作・動画の確認 | カード49件、予定書籍、private管理表示、日英ID対応 |

公開・計画・独立書籍を合わせた49件の内訳は公開42件、計画7件です。ホームの「41公開書籍」は
main-lineupの値で、独立英語書籍1件を加えた公開総数42と矛盾しません。
`web-mdbook-v1`はreader-visible raw HTMLを拒否し、Liquidのcatalog生成契約も移管しません。
metadataを足すだけでは、この入力差は解消しません。管理repositoryの可視性とWebの公開範囲も別概念です。無料previewの表示をpaid本文の閲覧権限と解釈しません。

Actionsは8workflowです。`deploy-pages.yml`はJekyll 4.4.1からPages artifactを作り、
build-infoとproduction smokeを持ちます。`pages-drift-check.yml`、`validate-learning-paths.yml`、
`pages-visual-check.yml`の責務も残す必要があります。残る4本は品質スプリント通知、書籍状態更新、
統一進捗更新、YouTube同期です。現行portalにはmdBook形式のsidebarはなく、
`#mdbook-sidebar` / `#sidebar` の重なりを「修正した」とは報告できません。

## 実行結果

### Portalの既存gateと本番観測

| Gate | 結果 |
| --- | --- |
| `npm ci --ignore-scripts` / `npm audit` | 成功 / 全severity 0 |
| `npm run verify:catalog` | schema/完了条件/graph/派生差分/fixture成功、debt 11・completion 11 tests成功 |
| `npm run test:production-smoke` | 合成unit 8 tests成功。本番確認とは区別 |
| `npm run test:pages-drift` | 合成unit 7 tests成功。全portfolioのdrift監査ではない |
| `npm run build:site` | Jekyll build成功 |
| `playwright test --workers=2` | 3project、57 tests成功（構造、axe、操作、動画） |
| read-only production smoke | 5 HTML routesとbuild-infoがHTTP 200、期待SHA一致、1 attemptで成功 |
| Pages API | `status=built`, `build_type=workflow` |

catalogの既存metadata debt（`estimatedWeeks` 39件、`reviewDate` 8件）は残っています。
validator/fixture成功は、未確定の編集値がすべて解消したという意味ではありません。

別の既存schedule `Update Unification Progress` の
[run 35557812431](https://github.com/itdojp/it-engineer-knowledge-architecture/actions/runs/35557812431)
（2026-09-21）はdashboard生成時にGitHub API HTTP 404で失敗しています。対象取得の根本原因は
未確定で、本調査はこのworkflowの正常性を証明しません。公開ページのsmoke成功と混同せず、
別の保守事項 [portal #296](https://github.com/itdojp/it-engineer-knowledge-architecture/issues/296) として追跡します。
workflow再実行・権限変更・失敗の無視は行っていません。

本番観測は既存公開物に対するread-only確認であり、新しいデプロイを実施したものではありません。
`/404.html`という実在ページへの200は、存在しない任意URLの404動作を証明しません。

baselineはローカルJekyll出力の `/`, `/books/`, `/paths/`, `/en/`, `/404.html` を使用しました。

| Viewport | ページ数 | body横はみ出し | nav/main重なり |
| --- | ---: | ---: | ---: |
| 390×844 | 5 | 0 | 0 |
| 480×900 | 5 | 0 | 0 |
| 768×1024 | 5 | 0 | 0 |
| 820×1180 | 5 | 0 | 0 |
| 1024×1366 | 5 | 0 | 0 |
| 1366×768 | 5 | 0 | 0 |

30 viewport画像とmanifestを保存。JavaScript例外・外部request 0、各ページh1は1件。
目視はhome/390、en/390、paths/820、books/1366の4画像で、navigationの折返しと本文分離を確認しました。
全画像・全scroll位置・すべての補助技術の目視確認を主張しません。viewport指定は実機試験ではありません。

画像は移行前baselineのみでafterはありません。新しい成果物との比較対象がないため、
同じ画像にbefore/afterという別名を付けて移行証跡にはしていません。

### 標準sampleによる対照確認

`examples/standard-book` / `edition=free` はfixtureの文書であり、portalから変換した原稿ではありません。

- dry-run、adapter生成、mdBook実build成功。
- build成果物だけを一時退避し、project全体を別出力への再生成と比較して差分0。
- 同じsource/editionのartifact visibility: documents 2/5、protected 5、findings 0。
- responsive: HTML 6、content pages 5、local links 129、6幅・60 browser probes成功。

この確認から言えるのは、入力を満たすsampleに対するtoolchainの成立だけです。
portalの49カード、7パス、動画、filter、権利表示などの同等性は検証していません。

## 再現手順

### 1. 専用cloneと前提

`WORKSPACE`は書込みを許可された作業rootとし、以下のclone先が存在する場合は上書きせず停止します。
Node/Jekyllは上記versionの既存環境を用意し、システムの自動更新は行いません。

```bash
set -euo pipefail
: "${WORKSPACE:?set an authorized workspace root}"
PORTAL="$WORKSPACE/worktrees/it-engineer-knowledge-architecture/issue104-readonly"
PORTAL_SHA=c48426e550f13ae41de0fad213896d420792914d
test ! -e "$PORTAL"
gh repo clone itdojp/it-engineer-knowledge-architecture "$PORTAL" -- --single-branch --branch main
git -C "$PORTAL" switch --detach "$PORTAL_SHA"
test "$(git -C "$PORTAL" rev-parse HEAD)" = "$PORTAL_SHA"
test -z "$(git -C "$PORTAL" status --porcelain)"
cd "$PORTAL"
mkdir -p tmp/issue104/npm
# 実行前の全tracked path/bytesを記録する。出力はignored領域に限る。
python3 - <<'PYHASH'
import hashlib, json, pathlib, subprocess
paths = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')[:-1]
hashes = {p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in paths}
pathlib.Path('tmp/issue104/tracked-before.json').write_text(json.dumps(hashes, sort_keys=True))
print(f'snapshotted {len(hashes)} tracked files')
PYHASH
export npm_config_cache="$PWD/tmp/issue104/npm"
# Chrome socket用の短いpath。workspace内で60bytes以下になるものを明示する。
export TMPDIR="$WORKSPACE/.p104"
mkdir -p "$TMPDIR"
npm ci --ignore-scripts
npm audit --audit-level=moderate
npm run verify:catalog
npm run test:production-smoke
npm run test:pages-drift
npm run build:site
```

Playwright browserが既に一致する場合は既存のものを読取り使用できます。新規取得する場合は
`PLAYWRIGHT_BROWSERS_PATH="$PWD/tmp/issue104/browsers"` をexportしてから
`./node_modules/.bin/playwright install chromium` を実行し、その変数をtestでも維持します。
必要なOS依存が不足する場合はその事実を記録し、無断のシステム変更やskipで代用しません。

```bash
CI=1 PORT=14277 ./node_modules/.bin/playwright test --workers=2
```

空いている専用portを使います。`CI=1`により既存serverを流用しません。
本番のread-only確認は次です。固定SHA以降に公開物が更新されていたら、失敗は直ちに回帰とはせず
live source/deploymentを再監査します。

```bash
node scripts/smoke-production.mjs --expected-sha "$PORTAL_SHA" --max-attempts 1 \
  --report-json tmp/issue104/public-smoke.json \
  --report-markdown tmp/issue104/public-smoke.md
```

### 2. 拒否と対照の再現

formatterも別のclean checkoutを `3b2ecf0822e6f76fe6213fd0bd764e04f99f8aaf` に固定し、
`npm ci --ignore-scripts`を通します。formatter rootで、`PORTAL`に上の絶対pathをexportして実行します。
期待される失敗をexit codeとmessageの両方でassertし、unexpected successも失敗にします。

```bash
export PORTAL
python3 - <<'PYCODE'
import os, pathlib, subprocess
out = pathlib.Path('.cache/issue104/direct-output')
assert not out.exists(), 'use a fresh output path'
r = subprocess.run(['npm', 'start', 'build', '--', '--book', os.environ['PORTAL'],
    '--target', 'web-mdbook', '--edition', 'free', '--out-dir', str(out), '--dry-run'],
    text=True, capture_output=True)
print(r.stdout + r.stderr)
assert r.returncode == 1 and 'book.yaml does not exist: book.yaml' in r.stdout + r.stderr
assert not out.exists()
PYCODE
```

mdBookの取得・hash検証・正常sample build・決定的再生成・visibility・responsiveは
[固定binaryの手順](../adapters/web-mdbook/README.md#buildとレスポンシブ検証)を使います。
`AUDITED_FORMATTER_SHA=3b2ecf0822e6f76fe6213fd0bd764e04f99f8aaf`、
`BOOK_ROOT=examples/standard-book`、`BOOK_EDITION=free`、
`BOOK_OUTPUT_ROOT=.cache/issue104/control`とします。取得済みbinaryを信用して再利用せず、
その手順の同じ検証block内で、cleanup前に次のnegative probeを追加できます。
`MDBOOK_BIN`をexportし、`PORTAL`を上と同じcloneへ設定します。

```bash
export MDBOOK_BIN PORTAL
python3 - <<'PYCODE'
import os, pathlib, subprocess
out = pathlib.Path('.cache/issue104/direct-mdbook').resolve()
assert not out.exists(), 'use a fresh output path'
r = subprocess.run([os.environ['MDBOOK_BIN'], 'build', os.environ['PORTAL'],
    '--dest-dir', str(out)], text=True, capture_output=True)
print(r.stdout + r.stderr)
assert r.returncode == 101 and 'src/SUMMARY.md' in r.stdout + r.stderr
assert not out.exists()
PYCODE
```

### 3. 6幅baselineの再取得

上のportal rootで、別terminalからloopback限定serverを起動します。

```bash
python3 -m http.server 14278 --bind 127.0.0.1 --directory .site
```

この固定sourceの `npm run build:site` は出力先 `.site/it-engineer-knowledge-architecture` と
baseurl `/it-engineer-knowledge-architecture` を明示しています。上のserverはその親 `.site` を
配信するため、次の `prefix` はこの組の契約値です。別のroot配信やbaseurlは本baselineの対象外で、
変更する場合はbuild/配信/prefixをまとめて再検証します。

次の内容を `tmp/issue104/baseline.mjs` に保存し、同じportal rootから
`node tmp/issue104/baseline.mjs` を実行します。初回は出力directoryがないことを確認し、
再取得時は以前の証跡を別の所有directoryへ退避します。終了後serverを停止します。

```javascript
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin = 'http://127.0.0.1:14278';
const prefix = '/it-engineer-knowledge-architecture';
const out = 'tmp/issue104/baseline';
const sizes = [[390,844],[480,900],[768,1024],[820,1180],[1024,1366],[1366,768]];
const routes = [['home','/'],['books','/books/'],['paths','/paths/'],['en','/en/'],['404','/404.html']];
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const observations = [], blocked = [], errors = [];
try {
  for (const [width,height] of sizes) {
    const context = await browser.newContext({ viewport: { width,height }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      blocked.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    for (const [name,path] of routes) {
      const response = await page.goto(origin + prefix + path);
      assert.ok(response, 'expected an HTTP document response');
      assert.equal(response.status(), 200);
      await page.evaluate(async () => { await document.fonts.ready; });
      const metrics = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="主要ナビゲーション"]');
        const main = document.querySelector('main#main-content');
        return {
          h1: document.querySelectorAll('h1').length,
          overflow: document.documentElement.scrollWidth > innerWidth,
          navMainOverlap: !nav || !main || nav.getBoundingClientRect().bottom > main.getBoundingClientRect().top,
          mdbookSidebar: document.querySelectorAll('#mdbook-sidebar, #sidebar').length,
          cards: document.querySelectorAll('[data-book-card]').length,
          title: document.title
        };
      });
      assert.equal(metrics.h1, 1);
      assert.equal(metrics.overflow, false);
      assert.equal(metrics.navMainOverlap, false);
      assert.equal(metrics.mdbookSidebar, 0);
      const file = `${name}-${width}.png`;
      await page.screenshot({ path: `${out}/${file}`, animations: 'disabled' });
      const hash = createHash('sha256').update(await readFile(`${out}/${file}`)).digest('hex');
      observations.push({ name, width, height, ...metrics, file, sha256: hash });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  await writeFile(`${out}/manifest.json`, JSON.stringify({ browser: browser.version(), routes: routes.length, observations, errors, blocked }, null, 2) + '\n');
  console.log(`PASS ${observations.length} page/viewport pairs; body-overflow/nav-overlap/JS-error/external-request 0`);
} finally { await browser.close(); }
```

### 4. 全portal検証後のcanonical照合

baselineを含む上の検証をすべて終えたあと、portal rootで実行します。初期snapshotとのpath集合・
各SHA-256を照合し、追加/削除/内容変更を拒否します。tracked statusも再確認し、差分があれば
調査前にreset/revertせず保存します。この照合が通るまでdrift 0とは報告しません。

```bash
python3 - <<'PYHASH'
import hashlib, json, pathlib, subprocess
before = json.loads(pathlib.Path('tmp/issue104/tracked-before.json').read_text())
paths = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')[:-1]
after = {p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in paths}
assert before == after, 'tracked source path/bytes changed; preserve and inspect the diff'
status = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], text=True)
assert not status, f'tracked status changed; preserve and inspect: {status}'
print(f'PASS {len(after)} tracked files unchanged after all portal checks')
PYHASH
```

## 証跡の保管と制限

ローカルの `tmp/issue104/baseline/` に30画像と `manifest.json` を保存しました。
公開repositoryには大きな生成物を収録せず、[集計と30画像のdigest](migration-report-it-engineer-knowledge-architecture.json)を添付します。
画像を別環境で取り直した際のpixel hash一致はgateではありません。font、browser、描画環境を記録し、
同じ30組の構造/geometryと意味を再検証します。原画像の目視監査が必要な場合は、保管workspaceから
このdigestを照合して提出するか、上の手順で再取得します。

## 次の判断・移行開始条件

現時点の推奨は、**portalをカタログとして維持し、書籍adapterを個別書籍へ適用すること**です。
これは観測からの設計上の提案であり、新しい対象へのrollout許可ではありません。

portal内で実験する場合も、運用ガイドなどの有限なpublic文書を独立した標準sourceへprojectionする
方式を先に設計し、原portalの代替ではないことを明示します。対象文書集合、canonical編集path、
更新時の追従、ID/anchor、権利・visibility、link差分の責務を決めるまで本文変換を開始しません。

| 未確定事項 | owner | 再開条件 |
| --- | --- | --- |
| pilotを個別書籍に変えるか、portal内の独立ガイドに限定するか | maintainer + 担当agent（#88/#104） | 対象sourceと受入条件をIssueへ明記 |
| portalを全面移行する場合のfeature parity | portal保守担当 | catalog/filter/日英/動画/graph/JSなし/公開範囲の同等性契約 |
| before/after比較 | pilot担当 | 同じreader task・content集合を比較できる成果物 |
| deployment切替 | portal管理者 | 別Issue/PR、rollback、Pages/HTTP/marker/本番確認の承認 |

今回のformatter PRにportal側の依存/CSS/JS/Actionsや本番設定変更を混ぜません。
既存portal PR279/295、unknown archive資産、他書籍、private/paid本文、別sessionのwhite-hat作業は対象外です。
#102の未確認資産を動かすことも、今回の適用可否調査の前提にはしません。
