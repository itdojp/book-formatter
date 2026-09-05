# Legacy consumer mutation contract

`update-book`、`sync-all-books`、`rollout-ux`、
`scripts/rollout_unification.sh`で既存Jekyll consumerを変更する場合の
runtime契約を定義します。この契約は新規標準書籍のadapter buildには使用しません。

## Fresh dependency bootstrap

`node src/index.js update-book`、`node src/index.js sync-all-books`、
`node src/index.js rollout-ux`と
`scripts/rollout_unification.sh`は、consumerや外部dependencyを読み込む前に
built-in-only launcherを通ります。launcherはplanから固定formatter SHAを読み、
formatterのHEADと全tracked fileのraw bytes、`package.json`、`package-lock.json`を
固定commitと照合し、lockfile SHA-256を実行証跡として導出します。

照合後は既存のignored `node_modules/`を再利用せず、real directoryであることを確認して
削除し、次の有限commandで再構成します。

```text
npm ci --ignore-scripts --no-audit --no-fund
```

repository rootの`.npmrc`と、監査対象`package-lock.json`を置き換え得る
`npm-shrinkwrap.json`はtracked/untracked/symlinkにかかわらず拒否します。user/globalの
npm設定によってinstall script境界が変わらないよう、launcherは
`--ignore-scripts`をcommand lineとsanitized environmentの両方で固定し、空の
user/global configを指定します。installが成功し、tracked bytesを再照合した後だけ、
module-private brandを持つin-process capabilityを発行してlegacy implementationをdynamic
importします。environment variable、plain object、serialized dataだけの自己申告や
`src/cli-implementation.js`の直接起動ではmutationを開始できません。programmatic mutation
boundaryも、実bootstrapが返した同じprocess capabilityがなければfail closedになります。
capabilityはplanのraw bytesと正規化した意味内容に拘束され、transactionはcaller-owned objectを
継続利用せず、attested bytesから作ったimmutable snapshotだけを使用します。

rollbackは監査済みGit blobを固定長のchild-process出力bufferへ保持せず、同一filesystem上の
排他的な一時fileへ直接materializeし、Git object digestを再検証してから置換します。mutationが
tracked fileの親directoryを削除していても、各階層をsymlink/non-directory検査しながら1段ずつ
再作成します。`git clean`はquiet modeで実行し、削除対象件数に比例する標準出力を蓄積しません。

mutation commandに`npm start`を使用してはいけません。npm lifecycleはlauncherより前に
既存`node_modules/.bin`を`PATH`へ追加し、project npm設定を読むためです。監査済みNode.js
executableで`node src/index.js ...`を直接実行します。`npm start` / `npm run dev`は専用の
非mutation compatibility entrypointへ接続し、mutation commandをdispatchしません。これらは
非mutationのlegacy compatibility commandに限る便宜的なscriptであり、fresh dependency境界では
ありません。npmがlauncherより前に読むproject設定や起動shellを安全化する保証はないため、
mutation手順でnpm自体を起動してはいけません。

programmatic利用では、built-in-onlyの`ConsumerDependencyBootstrap.cjs`から
`runFreshLegacyMutationProcess(args)`を呼びます。この関数は監査対象のbuilt-in-only bootstrap
entrypointを専用Node.js child processで起動し、parent processのmodule cacheを共有しません。callerから受け取った
引数とoptionは一度だけplain snapshotへ固定し、CommonJSの`require.main === module`で直接実行を判定するため、
後続getterや`process.argv[1]`の書き換えでin-process bootstrapへ切り替えることはできません。返却値は終了statusと
標準出力・標準エラーだけで、module constructorやin-process capabilityを返しません。
`loadFreshLegacyMutationApi()`はfail closedであり、同一process内のmodule cacheをfresh runtimeとして
再利用しません。`BookGenerator.js`、`UxRollout.js`、`ConsumerMutationBoundary.js`の直接importは
bootstrap entrypointではなく、fresh dependency保証を提供しません。plain objectをcapabilityとして
渡してもmutation boundaryは拒否します。

dependency再構成にはregistry accessが必要です。offline、DNS、proxy、registry rate limit、
integrity mismatchなどで`npm ci`が失敗した場合、launcherはpartial `node_modules/`を削除し、
legacy implementationをimportせずnon-zeroで終了します。consumerへのwriteはまだ始まっていません。
network/registryが復旧した後、同じformatter SHA、変更されていないplan、同じconsumer base SHAで
command全体を明示的に再実行してください。既存treeを手動で「検証済み」として再利用する
environment switchは提供しません。

この境界は、監査済みNode.js/npm/Git executableと単独実行processを前提にします。OS-level
process injection、実行中の同時filesystem改変、registry/toolchain自体の侵害を完全に防ぐ
sandboxではありません。

## 保証する境界

writeを開始する前に、runtimeは次を検証します。

- supported launcherがfresh dependency treeを再構成し、module-private in-process
  capabilityを発行している
- formatterの現在のcommitがplanで固定した40文字SHAと一致し、tracked内容・modeが
  commitと同一で、managed sourceにuntracked/ignored入力がない
- formatter/consumerにGit replacement refがない
- formatter/consumer監査時はoptional index lock、filesystem monitor、Git hookを無効化する
- consumerが監査済みbase SHAから作ったcleanなlinked worktreeであり、tracked fileに
  `skip-worktree`、`assume-unchanged`などのindex flagがない
- consumerのtracked blobのraw bytes、executable mode、symbolic-link targetがbase SHAと
  一致する。formatter/consumerのactiveなGit `filter` attributeは、dry-runの
  `git status`でも任意のclean
  driverを実行し得るため、filter-sensitiveな監査より前に一律拒否する。LFS等で
  working bytesがcommit blobと異なるworktreeも監査対象として拒否する。tracked
  submodule（gitlink）もnested worktreeのfilterやhookを監査前に実行し得るため拒否する
- rollbackはcheckout filterに依存せず、差分が残ったtracked fileをbase SHAのraw blobから
  復元して再検証する
- planがschema version 1、最大6件、重複なしの有限集合である
- operationが実行commandと一致する
- 実行対象がplan内のconsumer entryと完全一致し、write時は1件だけである
- operationが書き得る全destinationとplanの`allowedPaths`が完全一致する
- consumer root、全既存ancestor、final pathがsymlinkや想定外file typeでない
- destinationがGitでignoreされず、index modeが通常fileの契約を満たす

operation途中の失敗、allowlist外差分、HEAD変更を検出した場合は、対象linked
worktreeを固定base SHAへ戻し、未追跡fileを除去します。開始時にcleanであることを
要求するため、runtimeが既存の作業をrollback対象とすることはありません。

OS上の別processが同じtreeを同時に変更する競合を原子的に防ぐものではありません。
対象worktreeは単独processで使用してください。

## 有限plan

planはlocal運用情報を含むためcommitせず、workspace内の管理された一時領域に置きます。

```json
{
  "schemaVersion": 1,
  "operation": "rollout-ux-core",
  "formatterSha": "0123456789abcdef0123456789abcdef01234567",
  "consumers": [
    {
      "id": "sample-book",
      "worktree": "../worktrees/sample-book/book-formatter-sync",
      "baseSha": "89abcdef0123456789abcdef0123456789abcdef"
    }
  ]
}
```

この例は初回dry-run用なので`allowedPaths`を省略しています。表示されたmanaged pathを
すべて同じconsumer entryの`allowedPaths`へ追加し、再度dry-runして完全一致を確認してから
writeします。相対pathはplan fileのdirectoryを基準に解決します。`allowedPaths`はconsumer root
からの正規化済みrelative pathです。absolute path、`..`、重複は拒否されます。

利用可能な`operation`は次です。

- `update-book`
- `sync-all-books`
- `rollout-ux-core`
- `rollout-ux-profile`
- `rollout-ux-core-profile`

`update-book`と`sync-all-books`でconsumer内の`book-config.json`以外を入力にする
場合は、consumer entryへ`configPath`と`configSha256`を組で指定します。入力は
regular non-symlink fileでなければならず、読み込み時にSHA-256を照合します。

`rollout-ux-profile`と`rollout-ux-core-profile`は、plan rootへ
`registryPath`と`registrySha256`を組で必ず記録します。`--registry`は
planのpathと一致するregular non-symlink fileに限定され、内容は読み込み時に
SHA-256照合されます。dry-runとwriteの間でregistry内容が変わった場合は
writeを拒否します。profileを使わないoperationは、未使用のregistry指定を拒否します。

## dry-runから1 consumer writeまで

1. formatterを監査するcommitへ固定し、tracked差分がないことを確認する。
2. consumerの監査済みbase SHAからlinked worktreeを作る。
3. `allowedPaths`を省略したplanでdry-runし、表示されたmanaged pathをレビューする。
4. 表示結果を`allowedPaths`へ正確に記録して、同じSHAでdry-runを再実行する。
5. `--target`で1 consumerだけをwriteする。
6. 差分をレビューし、そのconsumer専用のbranch / PRへ反映する。
7. Book QA、PR CI、merge後main CI、Pages、公開HTTPを確認する。
8. すべて完了した後だけ、次consumerを別のcommand実行で明示する。

例:

```bash
AUDITED_BASE_SHA=89abcdef0123456789abcdef0123456789abcdef
git -C ../sample-book worktree add --detach \
  ../worktrees/sample-book/book-formatter-sync "$AUDITED_BASE_SHA"

node src/index.js rollout-ux \
  --plan .codex-local/tmp/rollout-plan.json \
  --apply-ux-core \
  --dry-run

# allowedPathsを固定した後、1冊だけ変更する
node src/index.js rollout-ux \
  --plan .codex-local/tmp/rollout-plan.json \
  --target sample-book \
  --apply-ux-core
```

write modeでは`--target`が必須であり、1回の実行が変更するconsumerは1件です。
途中失敗後はrollback結果を確認し、原因を修正して同じtargetを明示的に再実行します。
後続consumerへ暗黙には継続しません。

## operation別の変更範囲

| operation | runtimeが許可する範囲 |
|---|---|
| `update-book` / `sync-all-books` | `book-config.json`、`_config.yml`、`index.md`、top-level `_layouts/`、`_includes/`、`assets/`の有限managed file |
| `rollout-ux-profile` | `book-config.json`のみ |
| `rollout-ux-core` | `shared/version.json`とconsumer opt-outから選択した`docs/_layouts/`、`docs/_includes/`、`docs/assets/`、`book-config.json` |
| `rollout-ux-core-profile` | coreの範囲と`book-config.json` |

`update-book`はChapter directoryが不足している場合、本文を自動生成せずpreflightで
停止します。consumer本文の生成・書換えは本契約の対象外です。

`scripts/rollout_unification.sh`は`rollout-ux-core`の薄いwrapperです。branch作成、
commit、push、PR作成を自動化せず、同じplanと単一target境界を迂回しません。

```bash
scripts/rollout_unification.sh \
  --plan .codex-local/tmp/rollout-plan.json \
  --target sample-book \
  --dry-run
```

## 終了状態

- 成功: exit code `0`。writeではallowlist内のレビュー待ち差分が残る場合がある。
- preflight、mutation、postflight、rollback対象の失敗: non-zero。後続consumerは未実行。
- rollback自体も失敗: non-zeroかつ明示的なrollback failure。対象worktreeを手動監査する。

dry-runはmutation callbackを実行せず、file内容、HEAD、indexを変更しません。
