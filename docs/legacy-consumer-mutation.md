# Legacy consumer mutation contract

`update-book`、`sync-all-books`、`rollout-ux`、
`scripts/rollout_unification.sh`で既存Jekyll consumerを変更する場合の
runtime契約を定義します。この契約は新規標準書籍のadapter buildには使用しません。

## 保証する境界

writeを開始する前に、runtimeは次を検証します。

- formatterの現在のcommitがplanで固定した40文字SHAと一致し、tracked内容・modeが
  commitと同一で、managed sourceにuntracked/ignored入力がない
- formatter/consumerにGit replacement refがない
- consumerが監査済みbase SHAから作ったcleanなlinked worktreeであり、tracked fileに
  `skip-worktree`、`assume-unchanged`などのindex flagがない
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

npm start rollout-ux -- \
  --plan .codex-local/tmp/rollout-plan.json \
  --apply-ux-core \
  --dry-run

# allowedPathsを固定した後、1冊だけ変更する
npm start rollout-ux -- \
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
