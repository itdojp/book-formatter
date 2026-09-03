# web-jekyll-legacy adapter

- 実装状態: skeleton / legacy support contract
- 対象: 既存のJekyll / GitHub Pages書籍
- 現在のadapter出力: version 1 `manifest.json`のみ
- 互換境界の管理Issue: [#96](https://github.com/itdojp/book-formatter/issues/96)

`web-jekyll-legacy`は、既存consumerの保守経路を新規標準Web出力から分離するための名前である。新規書籍の標準Web出力は[`web-mdbook`](../web-mdbook/README.md)を使用する。Jekyllは廃止ではなくlegacy supportだが、新規標準の既定値ではない。

このREADMEは現行Jekyll資産の所有権と互換pathを定義する。`npm start build -- --target web-jekyll-legacy`はJekyll siteを生成せず、既存書籍を変更せず、deployもしない。Jekyll変換を実装済みと解釈してはならない。

## 現行の互換経路

| 入口 | 入力 | 現在の責務 | 書き込み先 / 結果 |
| --- | --- | --- | --- |
| `create-book` / `update-book` | legacy `book-config.json` | 組み込みJekyll templateと`shared/`を使う既存生成処理 | `update-book`は有限planから1 consumerのmanaged metadata/templateだけを更新 |
| `sync-all-books` | 最大6件の有限consumer plan | dry-run全件検査、または明示した1 consumerの更新 | fixed SHA / linked worktree / allowlist / rollbackをruntimeで強制 |
| `scripts/scaffold-new-book.sh` | owner / repository名 | template展開処理は保持されているが、現在は利用不可 | EXIT時に一時出力を削除し、`--create`もlocal Git repositoryを作らない。[#128](https://github.com/itdojp/book-formatter/issues/128) |
| `sync-components` | legacy `book-config.json`と`shared/version.json` | layouts / includes / assetsの選択同期 | consumerの`docs/`配下 |
| `rollout-ux` | finite consumer plan / legacy UX registry | UX profile更新と、明示指定時の共通component同期 | fixed SHA / linked worktree / allowlist / rollback / 単一targetをruntimeで強制 |
| `Book Sync` workflow | 最大3冊の明示対象 | consumer clone、preview、allowlist付きPR作成 | preview / writeともruntime destination検査とworkflow gateを要求 |
| adapter `build` | 標準`book.yaml`とedition | visibility検査済みbuild planの記録 | skeleton `manifest.json`のみ |

legacy `book-config.json`と標準`book.yaml`は別契約である。`create-book`、`update-book`、`sync-components`、`rollout-ux`へ`book.yaml`を暗黙変換して渡さない。反対に、既存書籍に`book.yaml`がないことを理由にlegacy経路を停止しない。

`scripts/scaffold-new-book.sh`は互換pathとして削除しないが、[#128](https://github.com/itdojp/book-formatter/issues/128)が完了するまで新規作成手順には使用しない。現行scriptは`--create`なしでもEXIT trapで一時出力を削除し、`--create`では`gh repo create --source`が要求する初期化済みlocal Git repositoryを用意しないため、永続的なlocal scaffoldもGitHub repositoryも作成できない。

## Jekyll componentの正本と同期先

現在`sync-components`が扱うJekyll consumer向け正本はrepository rootの`shared/`である。

| formatter source（`shared/version.json`のmanaged file） | consumer destination | 備考 |
| --- | --- | --- |
| `shared/layouts/book.html` | `docs/_layouts/book.html` | Jekyll layout |
| `shared/layouts/default.html` | `docs/_layouts/default.html` | Jekyll layout |
| `shared/includes/sidebar-nav.html` | `docs/_includes/sidebar-nav.html` | Liquid include |
| `shared/includes/page-navigation.html` | `docs/_includes/page-navigation.html` | Liquid include |
| `shared/assets/css/main.css` | `docs/assets/css/main.css` | CSS |
| `shared/assets/css/mobile-responsive.css` | `docs/assets/css/mobile-responsive.css` | CSS |
| `shared/assets/css/syntax-highlighting.css` | `docs/assets/css/syntax-highlighting.css` | CSS |
| `shared/assets/js/code-copy-lightweight.js` | `docs/assets/js/code-copy-lightweight.js` | JavaScript |
| `shared/assets/js/search.js` | `docs/assets/js/search.js` | JavaScript |
| `shared/assets/js/theme.js` | `docs/assets/js/theme.js` | JavaScript |
| `shared/version.json` | `book-config.json`の`shared.version` | 実fileまたはversion差分がある場合に更新 |

表は現行`shared/version.json`に列挙された有限集合であり、directory wildcardではない。たとえば、同じsource directoryにある未列挙fileは自動同期されない。`shared/schema/`、`shared/schemas/`、`shared/markdown/`、`shared/mdbook/`もこのJekyll同期mappingに含めない。`shared/schemas/book-config.schema.json`はlegacy config互換のschemaだが、Jekyll componentとして`docs/`へ配布するfileではない。

`templates/`の分類は[`templates/README.md`](../../templates/README.md)を参照する。top-level template、starter、UX template、workflow templateは用途と正本状態が異なるため、directory全体をJekyll adapterの実装資産として一括移動しない。

## 安全な同期手順

既存consumerへcomponentを反映するときは次の順序を守る。

1. 監査済みのformatter commit SHAを固定する。mutableな`main`を同期根拠にしない。
2. consumerのdefault branch、dirty status、Open PR、現在のPages方式を確認する。
3. 対象を1冊に限定し、dry-runでversion差分と予定componentを粗く確認する。

   ```bash
   (
   set -euo pipefail
   : "${AUDITED_FORMATTER_SHA:?set the audited 40-character formatter SHA}"
   test "$(git rev-parse HEAD)" = "$AUDITED_FORMATTER_SHA"
   test -z "$(git status --porcelain)"
   TRACKED_FORMATTER_FILES=0
   while IFS= read -r -d '' FORMATTER_REL; do
     test -f "$FORMATTER_REL"
     test ! -L "$FORMATTER_REL"
     test "$(git hash-object -- "$FORMATTER_REL")" = \
       "$(git rev-parse "$AUDITED_FORMATTER_SHA:$FORMATTER_REL")"
     TRACKED_FORMATTER_FILES=$((TRACKED_FORMATTER_FILES + 1))
   done < <(git ls-files -z)
   test "$TRACKED_FORMATTER_FILES" -gt 0
   if [ -e ./node_modules ] || [ -L ./node_modules ]; then
     test -d ./node_modules
     test ! -L ./node_modules
   fi
   NESTED_NODE_MODULES=$(find . \
     -path ./.git -prune -o -path ./node_modules -prune -o \
     -name node_modules -print -quit)
   test -z "$NESTED_NODE_MODULES"
   npm ci --ignore-scripts
   npm run sync-components -- \
     --book ../consumer-book \
     --components layouts includes assets \
     --dry-run
   )
   ```

   現行dry-runは`shared.version`が一致するとfile内容を比較せず終了するため、差分0の証拠には使用しない。

4. consumerの監査済みbase SHAから隔離した一時worktreeを作り、そのcopyへ通常同期して`git diff`を確認する。

   ```bash
   (
   set -euo pipefail
   : "${AUDITED_FORMATTER_SHA:?set the audited 40-character formatter SHA}"
   : "${AUDITED_BASE_SHA:?set the audited 40-character consumer base SHA}"
   [[ "$AUDITED_BASE_SHA" =~ ^[0-9a-f]{40}$ ]]
   test "$(git -C ../consumer-book rev-parse --verify "$AUDITED_BASE_SHA^{commit}")" = \
     "$AUDITED_BASE_SHA"
   test "$(git rev-parse HEAD)" = "$AUDITED_FORMATTER_SHA"
   test -z "$(git status --porcelain)"
   TRACKED_FORMATTER_FILES=0
   while IFS= read -r -d '' FORMATTER_REL; do
     test -f "$FORMATTER_REL"
     test ! -L "$FORMATTER_REL"
     test "$(git hash-object -- "$FORMATTER_REL")" = \
       "$(git rev-parse "$AUDITED_FORMATTER_SHA:$FORMATTER_REL")"
     TRACKED_FORMATTER_FILES=$((TRACKED_FORMATTER_FILES + 1))
   done < <(git ls-files -z)
   test "$TRACKED_FORMATTER_FILES" -gt 0
   if [ -e ./node_modules ] || [ -L ./node_modules ]; then
     test -d ./node_modules
     test ! -L ./node_modules
   fi
   NESTED_NODE_MODULES=$(find . \
     -path ./.git -prune -o -path ./node_modules -prune -o \
     -name node_modules -print -quit)
   test -z "$NESTED_NODE_MODULES"
   npm ci --ignore-scripts
   CONSUMER_SYNC_WORKTREE=../.worktrees/consumer-sync-pilot
   test ! -e "$CONSUMER_SYNC_WORKTREE"
   test ! -L "$CONSUMER_SYNC_WORKTREE"
   git -C ../consumer-book worktree add --detach \
     "$CONSUMER_SYNC_WORKTREE" "$AUDITED_BASE_SHA"
   cleanup_consumer_sync_worktree() {
     git -C ../consumer-book worktree remove --force \
       "$CONSUMER_SYNC_WORKTREE"
   }
   trap cleanup_consumer_sync_worktree EXIT
   test "$(git -C "$CONSUMER_SYNC_WORKTREE" rev-parse HEAD)" = \
     "$AUDITED_BASE_SHA"
   test -z "$(git -C "$CONSUMER_SYNC_WORKTREE" status --porcelain)"

   # 現行sync scriptは同期先のsymlink / gitlink境界を検査しない。通常同期の前に、
   # consumer設定で実際に選択された有限のmanaged destinationと全ancestorを検査する。
   node --input-type=module - "$CONSUMER_SYNC_WORKTREE" <<'NODE'
   import { execFileSync, spawnSync } from 'node:child_process';
   import fs from 'node:fs';
   import path from 'node:path';
   import { ComponentSync } from './scripts/sync-components.js';

   const root = path.resolve(process.argv[2]);
   const componentSync = new ComponentSync();
   await componentSync.loadVersion();
   const bookConfig = await componentSync.loadBookConfig(root);
   if (!bookConfig) {
     throw new Error(`consumer book-config.json is required: ${root}`);
   }
   const componentsToSync = componentSync.determineComponents(bookConfig, {
     components: ['layouts', 'includes', 'assets'],
   });
   const managedDestinations = ['book-config.json'];
   for (const [component, config] of Object.entries(componentsToSync)) {
     const enabled = config === true || (
       typeof config === 'object' && Object.values(config).some(Boolean)
     );
     if (!enabled) continue;
     const componentInfo = componentSync.version.components[component];
     if (!componentInfo) {
       throw new Error(`managed component is absent from shared/version.json: ${component}`);
     }
     for (const file of componentInfo.files ?? []) {
       if (typeof config === 'object') {
         const subcomponent = path.basename(path.dirname(file));
         if (config[subcomponent] === false) continue;
       }
       const destination = componentSync.mapDestRelativePath(file)
         .split(path.sep)
         .join('/');
       if (managedDestinations.includes(destination)) {
         throw new Error(`duplicate managed destination: ${destination}`);
       }
       managedDestinations.push(destination);
     }
   }
   const indexModes = new Map(
     execFileSync('git', ['-C', root, 'ls-files', '--stage', '-z'], {
       encoding: 'utf8',
     })
       .split('\0')
       .filter(Boolean)
       .map((entry) => {
         const [metadata, filePath] = entry.split('\t');
         return [filePath, metadata.split(' ')[0]];
       }),
   );

   const rootStat = fs.lstatSync(root);
   if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
     throw new Error(`consumer worktree must be a real directory: ${root}`);
   }

   for (const destination of managedDestinations) {
     const ignoreCheck = spawnSync(
       'git',
       ['-C', root, 'check-ignore', '--quiet', '--', destination],
       { encoding: 'utf8' },
     );
     if (ignoreCheck.error || ![0, 1].includes(ignoreCheck.status)) {
       throw ignoreCheck.error ?? new Error(
         `git check-ignore failed for ${destination}: ${ignoreCheck.stderr}`,
       );
     }
     if (ignoreCheck.status === 0) {
       throw new Error(`refusing ignored managed destination: ${destination}`);
     }

     const finalPath = path.join(root, destination);
     let current = root;

     for (const segment of destination.split('/')) {
       current = path.join(current, segment);
       const relative = path.relative(root, current).split(path.sep).join('/');
       const indexMode = indexModes.get(relative);
       if (current !== finalPath && indexMode !== undefined) {
         throw new Error(
           `refusing non-directory index boundary (${indexMode}): ${relative}`,
         );
       }
       if (
         current === finalPath &&
         indexMode !== undefined &&
         !['100644', '100755'].includes(indexMode)
       ) {
         throw new Error(
           `managed destination has invalid index mode (${indexMode}): ${relative}`,
         );
       }
       let stat;
       try {
         stat = fs.lstatSync(current);
       } catch (error) {
         if (error.code === 'ENOENT') {
           if (current === finalPath && indexMode !== undefined) {
             throw new Error(`tracked managed destination is missing: ${relative}`);
           }
           break;
         }
         throw error;
       }
       if (stat.isSymbolicLink()) {
         throw new Error(`refusing symlink destination: ${current}`);
       }
       if (current !== finalPath && !stat.isDirectory()) {
         throw new Error(`destination ancestor is not a directory: ${current}`);
       }
       if (current === finalPath && !stat.isFile()) {
         throw new Error(`destination is not a regular file: ${current}`);
       }
     }
   }
   NODE

   npm run sync-components -- \
     --book "$CONSUMER_SYNC_WORKTREE" \
     --components layouts includes assets
   git -C "$CONSUMER_SYNC_WORKTREE" status --short
   git -C "$CONSUMER_SYNC_WORKTREE" add -N --all
   git -C "$CONSUMER_SYNC_WORKTREE" diff --
   git -C "$CONSUMER_SYNC_WORKTREE" reset --
   )
   ```

   formatter checkoutはtracked fileを1件ずつ監査済みSHAのblobへ照合するため、managed sourceだけでなく同期script、import先、`package.json`、lockfile、metadataもsparse checkout、欠損、symlink、skip-worktreeで隠された変更があれば同期前に拒否する。rootの`node_modules/`は照合済みlockfileから`npm ci --ignore-scripts`で再構築し、root以外の`node_modules`は未追跡・ignored・symlinkを含めて同期前に拒否する。consumer側の有限リストは、監査済み`ComponentSync.determineComponents()`、`shared/version.json`、実行時と同じ上位component filterから導出し、書籍側のcomponent / subcomponent opt-outを保持する。これに、このコマンドが更新し得る`book-config.json`を加える。各destinationについてignore規則、tracked fileの欠損・file mode、全ancestorのindex modeとworktree file typeを確認し、gitlink、symlink、通常directory以外の境界を拒否する。`shared/version.json`へmanaged fileを追加した場合も選択結果から自動的に検査対象となる。`git add -N --all`は一時worktreeの未追跡fileを内容付きdiffへ含めるためだけに使い、直後の`reset`でintent-to-addを解除する。これにより、新規layoutやassetもpath名だけでなく内容を監査できる。EXIT trapは成功時と途中失敗時の両方で、同期差分を持つ一時worktreeを`--force`付きで登録解除・削除する。同期結果をこの一時worktreeからcommitしない。

5. managed file以外、書籍本文、書籍固有設定が差分へ入っていないことを確認する。`book-config.json`は`shared.version` / `lastSync`以外の変更を許容しない。
6. 確認済み差分だけをconsumerごとのtask branch / PRで再現する。複数書籍を同じPRへ混在させない。
7. consumerのBook QA、main CI、Pages deployment、公開HTTPと主要markerを確認する。

`Book Sync` workflowのpreview / writeは、いずれも選択destinationと`book-config.json`を全write前に検査する同じ`ComponentSync`を使用する。root/ancestor/final symlink（danglingを含む）、non-directory ancestor、non-regular final、root escapeを拒否し、後段destinationが不正な場合も先行fileをcopyしない。各write直前にも境界を再検査するが、同じconsumer treeを別processが同時に変更する競合まで原子的に防ぐ契約ではないため、隔離checkoutを単独で操作する。既定preview、最大3冊、確認token、対象repositoryへのwrite権限、Open PR 0、allowlist付きconsumer別PRという既存gateも引き続き必須である。

`scripts/rollout_unification.sh`は[legacy consumer mutation contract](../../docs/legacy-consumer-mutation.md)を使う単一consumer wrapperである。旧来のbranch切替、commit、push、PR作成は行わない。fixed formatter/base SHA、clean linked worktree、有限allowlist、`ComponentSync` destination境界を同じruntime transactionで検証し、consumer別review gateが終わるまで次targetへ進まない。

## `rollout-ux`との境界

- `--apply-ux-core`は`ComponentSync`を介してlayouts / includes / assetsを同期する。
- `--apply-ux-profile`はplanにpathとSHA-256を固定したlegacy UX registryの`profile` / `modules`を`book-config.json`へ反映する。
- portfolio-level [`book-registry.yaml` version 1](../../docs/book-registry.md)は同じ名前でも入力互換ではない。
- dry-runは有限planの全targetまたは明示targetを検査し、file内容を変更しない。
- writeは`--target`で1 consumerだけを選び、profile/coreを同じtransactionへ含める。profileをcore writeの境界迂回には利用できない。
- plan schema、allowlist確定、rollback、明示再開は[legacy consumer mutation contract](../../docs/legacy-consumer-mutation.md)を正本とする。

## 維持する互換path

Issue #96では次のpathを移動・削除しない。

- `shared/layouts/`, `shared/includes/`, `shared/assets/`
- `templates/starter/`, `templates/.github/`, `templates/ux/`
- top-level `templates/_config.yml`, `templates/_data/`, `templates/_includes/`, `templates/assets/`
- Jekyll運用を説明する既存`docs/`
- `create-book`, `update-book`, `sync-components`, `rollout-ux`

正本が未確定のsnapshotを含むため、単純なcopyやhash一致だけを移動・削除根拠にしない。物理移動は[`docs/archive-plan.md`](../../docs/archive-plan.md)に従い、fixed-SHA consumer pilotと互換shimの要否を確認する別PRで行う。

## 非目標

- Jekyll assetの移動、削除、archive
- 既存consumerへの同期またはmdBookへの強制移行
- GitHub Pages設定、branch source、Actions workflowの変更
- Jekyll build / deployの新規実装
- `web-jekyll-legacy`を実装済みadapterへ変更すること
- standard-book visibilityをlegacy consumerへ未検証で適用すること

Web出力の選択基準は[出力target方針](../../docs/output-targets.md)、共通adapter CLIは[Adapter開発契約](../README.md)を参照する。
