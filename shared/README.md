# shared directory contract

`shared/`は複数の契約を保持する。directory全体がJekyll専用でも、全書籍へ自動同期されるわけでもない。

## 分類

| path | 状態 | 責務 |
| --- | --- | --- |
| `layouts/` | active legacy sync source | Jekyll layoutをconsumerの`docs/_layouts/`へ同期 |
| `includes/` | active legacy sync source | Liquid includeをconsumerの`docs/_includes/`へ同期 |
| `assets/` | active legacy sync source | Jekyll向けCSS / JavaScript等をconsumerの`docs/assets/`へ同期 |
| `version.json` | active legacy sync metadata | managed component、version、互換条件を定義 |
| `schemas/book-config.schema.json` | active legacy config schema | 既存`book-config.json`を検証。consumer `docs/`へ同期しない |
| `schema/book.schema.json` | active standard schema | 標準`book.yaml` version 1を検証 |
| `schema/book-registry.schema.json` | active registry schema | portfolio-level book registry version 1を検証 |
| `markdown/` | active standard authoring contract | 標準Markdown規則。`sync-components`対象外 |
| `mdbook/` | active `web-mdbook` asset | mdBook追加theme。Jekyll consumerへの同期対象外 |

## Jekyll component mapping

`scripts/sync-components.js`はJekyll向けのlayouts / includes / assetsに次のmappingを使用する。

| formatter source（managed file） | consumer destination |
| --- | --- |
| `shared/layouts/book.html` | `docs/_layouts/book.html` |
| `shared/layouts/default.html` | `docs/_layouts/default.html` |
| `shared/includes/sidebar-nav.html` | `docs/_includes/sidebar-nav.html` |
| `shared/includes/page-navigation.html` | `docs/_includes/page-navigation.html` |
| `shared/assets/css/main.css` | `docs/assets/css/main.css` |
| `shared/assets/css/mobile-responsive.css` | `docs/assets/css/mobile-responsive.css` |
| `shared/assets/css/syntax-highlighting.css` | `docs/assets/css/syntax-highlighting.css` |
| `shared/assets/js/code-copy-lightweight.js` | `docs/assets/js/code-copy-lightweight.js` |
| `shared/assets/js/search.js` | `docs/assets/js/search.js` |
| `shared/assets/js/theme.js` | `docs/assets/js/theme.js` |

章本文、付録、書籍固有`index.md`、`docs/_config.yml`、workflow、標準Markdown、mdBook themeはこのJekyll mappingに含めない。別component名を明示した場合、sync scriptはsource相対pathを維持するfallbackを持つが、Issue #96のJekyll同期手順と`Book Sync` workflowはlayouts / includes / assetsだけを選択する。

同期対象の有限file集合とversionは`shared/version.json`を正本とする。directoryにfileが存在するだけではmanaged componentにならない。`templates` metadataは既定で無効であり、現在`shared/templates/`は存在しないため、Jekyll templateの配布経路として使用しない。

## ローカル同期

最初のdry-runから[`web-jekyll-legacy` adapter contractの「安全な同期手順」](../adapters/web-jekyll-legacy/README.md#安全な同期手順)を正本として実行する。この入口はformatterの全tracked fileを監査済みSHAのblobへ照合し、照合済みlockfileから依存関係を再構築してから予定componentを確認する。`shared/README.md`には同等の実行blockを複製しない。

現行dry-runはconsumerの`shared.version`が一致する場合も、選択されたmanaged fileをbyte比較し、欠落・差分があれば表示する。「最新です」はその選択範囲の確認結果であり、未選択・opt-out fileや同時変更まで含む差分0の証明ではない。version不一致時は引き続き予定componentの一覧を示す。隔離worktreeへの通常同期も同じadapter contractの手順4を実行する。`sync-components` runtime自体も、選択された全managed destinationと`book-config.json`を最初のwrite前に`lstat`し、root/ancestor/final symlink、non-directory ancestor、non-regular final、root escapeを拒否する。runtime検査は固定SHA・clean base・差分reviewを代替しない。

同手順の`git add -N --all`は未追跡の新規managed fileを内容付きdiffへ含めるためだけに使い、監査後の`reset`でintent-to-addを解除する。同期結果を一時worktreeからcommitしない。consumerの`book-config.json`にあるopt-outはCLI指定で上書きしない。`shared.version`を進めるのは、書籍で有効な全componentのmanaged fileが選択され、同期元が存在し、同期後のbyte一致を確認した場合だけである。部分同期で実fileが変わった場合は`lastSync`だけを更新し、全体versionは保持する。未変更の部分同期、空の選択ではmetadataを更新しない。全体versionが既に一致していても、JSの再有効化や過去の不完全な同期を隠さないようdry-runは実fileを検査する。確認済み差分だけをconsumerのtask branchへ再現し、Book QA前にallowlist外の変更がないことを確認する。

## Book Sync workflow

`.github/workflows/book-sync.yml`は`workflow_dispatch`専用であり、formatterのmergeだけでは起動しない。

preview / writeはいずれもconsumer cloneで同じ`ComponentSync` destination境界を通る。previewもcloneへ実同期して差分を表示するため、下記のworkflow gateとruntime検査を併用し、手動Runbookの固定SHA・全tracked blob監査と同等であるとは扱わない。

- 既定はdry-run。
- 最大3冊を明示する。`all`は指定できない。
- write modeは確認tokenとcross-repository tokenを要求する。
- 実行者とtokenのwrite権限、対象のOpen PR 0をpreflightする。
- allowlist外の変更や未追跡fileが残る場合は停止する。
- consumerごとにbranch / PRを作り、mainへ直接pushしない。

## `rollout-ux`との関係

`rollout-ux --apply-ux-core`は同じ`ComponentSync`境界を使う。core/profile writeはいずれも[legacy consumer mutation contract](../docs/legacy-consumer-mutation.md)の固定formatter/base SHA、clean linked worktree、有限allowlist、rollback、単一targetを要求する。`--apply-ux-profile`はlegacy UX registryの`profile` / `modules`を`book-config.json`へ反映する別operationであり、portfolio-level book registry version 1とは入力互換ではない。

```bash
node src/index.js rollout-ux \
  --plan .codex-local/tmp/ux-plan.json \
  --registry ./legacy-ux-registry.json \
  --apply-ux-core \
  --apply-ux-profile \
  --dry-run
```

## 変更とconsumer検証

### Responsive header contract (#115)

共有Headerは書名の領域だけを縮小し、長い書名を視覚的に省略する。リンクの
全文字列とaccessible nameは保持する。Controlsは折り返し、狭幅でもSearchを
非表示にしない。DOM順序とTab順序は書名、Search、右側Controlsの順で維持する。
新しいoverflow menuや、Header全体を隠す`overflow-x: hidden`は使わない。

Headerは内容に応じた高さを持つ。layout内の小さな計測処理が
`--header-height`を実寸へ同期し、本文、Sidebarとanchorの開始位置をそろえる。
`ResizeObserver`が使えない環境ではwindow resizeを使う。Safe-areaは
`env(safe-area-inset-left/right)`をpaddingへ反映する。

`npm run test:shared-header-browser`はネイティブChrome必須の有限検証である。
9幅（320〜1366px）、4種の合成書名/ラベル、Light/Dark、通常幅と200%相当の
CSS viewport reflow、別の200%文字拡大で162条件を検証する。実際のTab入力、
Focus表示、PointerによるTheme切替、document/Headerの幅、本文/Sidebarのoffset、
同一ページでのresizeも検証する。これらをinteractive browser zoomの測定や、
実端末のnotch検証とは扱わない。単体テストでCSSレンダラーを再実装しない。

展開した検索パネルは検索欄の行ではなくHeader全体の下端に配置し、Headerの
安全な左右padding内で中央にそろえる（最大400px）。高さは残りviewport内に
制限し、単一のscroll領域で末尾の検索結果まで到達できる。`dvh`非対応環境には
`vh`を使う。Controlsや検索を隠して重なりを回避しない。
同じnative gateでshipped `search.js`に多数の「学習」検索結果を作らせ、通常/
reflowに短い160/683×478 CSS viewportを加えた152条件を検証する。展開中の
Control hit/Theme切替、Escape、実wheelによる末尾結果のクリック、開いたままの
resizeも含む。別途実ブラウザ200% zoomとconsumer側の公開DOM/CSSの組合せを
確認する必要があり、合成fixtureの成功だけでconsumer sign-offとはしない。

SidebarのEnter/Space activation、既存hidden checkboxのTab位置、Escape/focus
managementとnested navigation landmarkは別の#116の責務である。consumerの
同期/pin更新はこの共有修正と別PRで行う。

1. formatterの監査済みcommit SHAを固定する。
2. managed fileと`shared/version.json`を同じPRで整合させる。
3. 代表consumerでdry-runし、変更pathを確認する。
4. consumerごとにPRを作成する。
5. Book QA、merge後main、Pages deployment、公開HTTPと主要markerを確認する。
6. 回帰時はrolloutを停止し、旧path / versionへ戻せる証跡を保持する。

Jekyll互換の全体像は[`web-jekyll-legacy` adapter contract](../adapters/web-jekyll-legacy/README.md)、物理移動の条件は[`docs/archive-plan.md`](../docs/archive-plan.md)を参照する。
