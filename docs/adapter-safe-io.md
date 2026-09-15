# Adapter held-tree I/O 入力契約

`src/AdapterSafeIO.js`の`readFileFromHeldTree(root, rootIdentity, relativePath, options)`と`bindDirectoryFromHeldTree()`を直接呼ぶ開発者向けの有限契約です。一般的なsandboxや任意の敵対的JavaScript callerを実行する仕組みではありません。

## 最大サイズ

`options`は必須object、`maximumSize`は**正のsafe integer（bytes）**を明示します。省略、null、NaN、Infinity、0、負数、小数、safe integer超過、string/boolean/bigint等は、directory identity参照・traversal・child process・file readより前に`AdapterSafeIOError`で拒否します。文字列からの数値変換や無制限の既定値は設けません。正常な上限でもメモリ予算として適切かはcallerが判断し、metadataから任意上限を受け取らないでください。

現行callerはNote画像20MiB、Note PDF添付50MiB、Zenn画像3MiBのprivate定数を渡します。上限以下のfileだけを読み、path/open/completionのidentity・size・変更を既存の検査で確認します。`pathLabel`/`tooLargeMessage`は診断用であり、サイズ検査を無効にしません。

## パス：native入力とPOSIX出力を分ける

held-tree入力は**実行OSのnative filesystem相対パス**です。呼び出す前に既存callerと同様`path.resolve` / `path.relative`で変換します。helper内部ではseparatorの置換や`..`の正規化をしません。

| 入力 | POSIX | Windows |
| --- | --- | --- |
| `nested/data.bin` | nativeとして許可 | forward slashは拒否 |
| `nested\data.bin` | backslashを含むため拒否 | nativeとして許可 |
| 絶対・rooted・UNC・device path | 拒否 | 拒否 |
| `C:relative.bin` | literal filenameとして許可 | drive-relativeとして拒否 |
| `data.bin:stream` | literal filenameとして許可 | alternate stream指定として拒否 |
| `.` / `..` / 空component / 重複separator / NUL / mixed separator | 拒否 | 拒否 |

Windowsのdrive-relativeは`path.isAbsolute()`だけでは拒否できないため、native `path.parse(...).root`を検査します。POSIXのcolonをWindows driveへ読み替えません。NodeのOS別path動作については[公式path API](https://github.com/nodejs/node/blob/v22.22.2/doc/api/path.md#windows-vs-posix)も参照してください。WindowsでPOSIXパスを新規に受理するAPI拡張は行いません。

staging/outputの論理namespaceは別契約でPOSIX相対パスを使用します。URLやrepositoryのPOSIXパスをnative held-tree APIへそのまま渡さないでください。元のpathの意味を変える一括backslash置換も禁止です。

## 保証範囲と検証

- 正常nested read、exact limitと超過、directory/file symlink、root/child-directory identity変更を直接回帰で確認します。
- invalid options/pathの回帰は、identityに触れると失敗するprobeを使い、I/O前の拒否を検査します。
- Node20/22/24のroot回帰に加え、CIの`Held-tree I/O (Windows)`でNode24のnative実行を確認します。POSIX-only filename試験はWindowsでskip理由を明示します。Windows file symlink privilegeがなければ当該試験だけskipし、directory junctionの試験は別に実行します。
- このjobはWindowsで全adapter/staging/buildを検証するものではありません。未実行のplatformやscenarioを合格とみなしません。
- 同一UIDの敵対的並行writer/output-parent transactionは[#138](https://github.com/itdojp/book-formatter/issues/138)の別課題です。この入力guardでその境界を解決したとは主張しません。

実装・受入条件は[#150](https://github.com/itdojp/book-formatter/issues/150)を参照してください。
