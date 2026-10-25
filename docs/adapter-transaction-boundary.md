# Adapter transactionの信頼境界

## 対象と前提

この文書はformatter保守者とadapter開発者向けの、[#138](https://github.com/itdojp/book-formatter/issues/138)の段階的な監査・設計判断です。同Issue全体の完了証明ではありません。

buildは、管理下のuser-owned・非shared workspaceで実行します。同じsource、config、output、output親に対する編集とbuildを直列化し、既存出力には手動原稿や別用途のfileを置かないでください。manifestは「このtargetが生成した出力」の判定資料であり、電子署名や削除権限の証明ではありません。同一UIDで書き込めるprocessはmanifest自体を作れます。

- **扱うもの**: 誤った出力先、別producerの出力、symlink、検査と利用の間で検出できるidentity/contentの変化、失敗時の既存出力保護。
- **保証しないもの**: hostile same-UID processからの隔離、任意の並行writerとの直列化、atomicな複数file snapshot、crash時のtransaction durability、最後の検査後もsource/pathが不変であること。
- UUID、mode `0700`、advisory lock、反復検査はsame-UID隔離の代替ではありません。書込み可能な同一UIDに対してこの契約を拡張したとは主張しません。

## 現行経路の棚卸し

監査baselineはmain `44444af46a3e213c7d2b4c25183f79f5cc8d88cf`。共有manifest読取だけが今回の実装修正です。以下の同一文字列は同等の安全保証を意味しません。

| 経路 | source / config | staging・install | rollback・cleanup / 残る境界 |
| --- | --- | --- | --- |
| [Zenn](../src/ZennAdapter.js) | visibility digestに結び付けたsource読取、metadata再照合、held-tree asset読取 | shared `createStagingTree` / `replaceOwnedDirectory` | shared identity検査。親rename・directory作成直後のsame-UID差替えは非保証 |
| [note](../src/NoteAdapter.js) | visibility digest、metadata再照合、画像/PDFのheld-tree読取 | shared staging / replacement | 同上。投稿や公開サービス側のtransactionは対象外 |
| [PDF / Kindle plan](../src/PrintPublicationPlan.js) | visibility snapshotを引き継ぎ、metadata digestを再照合 | shared staging / replacement | plan-only。本文の実render・現在の全sourceのatomic snapshotは保証しない |
| [BOOTH plan](../src/BoothPackage.js) | full/sampleのsource digest再照合、held-tree commerce config読取 | shared staging / replacement | plan-only ZIP。後続source変更まで無効化しない |
| [Web mdBook](../src/WebMdbookAdapter.js) | 独自のsource/asset検証とproject生成 | 独自staging・backup rename | path-based manifest読取・recursive cleanupを含む独自実装。今回のshared修正は適用されない |
| [manifest-only skeleton](../src/AdapterBuild.js) | 共通schema/edition/visibility検査 | 一時manifestを`wx`で書いてrename | manifest file単位の処理。shared directory transactionとは別 |

`web-jekyll-legacy`の標準buildは最後のskeleton経路です。既存Jekyll consumerを変更する互換CLIは[別のmutation契約](legacy-consumer-mutation.md)を持ち、この表で全経路を検証済みとはしません。隔離EPUB rendererもこの修正とは別のtoolchainです。

shared replacementは、staging/old output/保護rootのidentity、staging entryとdigest、metadataを段階的に確認します。install前の失敗では旧outputを保持し、検出した別identityをrollbackで再帰削除しません。commit後のbackup cleanup失敗は新outputを維持してretained pathを報告します。ただし、backup内部の任意entryをrenameできる敵対的writerまで隔離する設計ではありません。

## 今回の修正: ownership manifestの読取

`AdapterSafeIO.assertOwnedExistingOutput()` は次を実施します。

1. outputが実directory、manifestが非symlinkのregular fileであることを`lstat`で確認する。
2. `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`でmanifestをopenする。POSIXの`O_NONBLOCK`は、検査後にFIFOへ差し替えられた場合のwriter待ちを避ける。
3. 同じhandleの`stat`で、事前検査とdev/ino/type/size/mtime/ctimeが一致することを確認する。
4. そのhandleからbytesを読み、読取後のhandleとpathのstat、bytes長を再照合する。照合後にのみJSONをparseする。
5. 成否にかかわらずhandleをcloseする。producer/target判定とoutput directory identityの再確認も維持する。

file pathを検査してから`fs.readFile(path)`で別objectを読むwindowを縮める修正です。ancestor pathのheld-handle化、一般的なsnapshot API、manifestの新しいサイズ上限は導入しません。fileを開いた後の検査だけで無制限のin-place writerや最後の検査後の差替えまで防げる、という主張はしません。

Nodeの[FileHandle APIとfilesystem flags](https://nodejs.org/docs/latest-v24.x/api/fs.html)を使用します。flagsの提供・意味はOSで異なるため、flagsだけを合否根拠にしません。Windowsでもregular-file/identity/前後statによる照合を実施し、検査できない場合はエラーにします。Windows held-tree CIはhelperの検証であり、全adapterのWindows対応を認定するものではありません。

## 設計候補の比較と今回の採否

| 候補 | 利点 | 解消しない境界・負担 | 今回の判断 |
| --- | --- | --- | --- |
| 非shared親＋source/config編集とbuildの直列化 | portable、現行の運用前提を維持 | 非協調的writerは排除できない。排他を自動強制したとは言えない | 既定前提として維持 |
| native helper / Linux `openat2`等 | descriptor基準のpath resolution強化を検討できる | OS別実装・配布・fallback検証が必要。mutable source全体のatomic snapshotにはならない | 今回は導入せず#138に残す |
| 同一filesystemのprivate staging＋immutable input snapshot | build inputの寿命とinstall境界を設計できる | private directoryだけではsame-UIDから隔離できない。権限境界、snapshot作成、rename/復旧の設計が必要 | 独立した設計・実機検証が必要 |
| cleanupを既知entryとidentityへさらに限定 | 予期しないentryの削除範囲を縮小できる | 各entryの並行差替えとrollbackも検証が必要。recursive cleanup全体の置換は今回の小修正ではない | audit項目として保持 |

native機能がない環境でpath-based処理へ黙ってfallbackして、同じ強保証を名乗ることはしません。今回新しいplatform-specific強保証を採用していないため、新しいfallbackも追加していません。

## 入力snapshotの意味

`source_visibility: passed-for-plan-snapshot` は、検証時に観測したsourceの判定です。最後の文書を読む間に先に読んだ文書が変更され得るため、逐次再読取を増やしても複数fileをatomicに凍結したことにはなりません。並行編集を止める運用前提と、保存されたdigestに対応する出力を、live sourceの継続的な最新性から分離します。[BOOTH契約](commerce.md)も参照してください。

## 検証と未完了項目

- helperの直接回帰: stable UTF-8 manifest、producer不一致、null/invalid JSON、path-based read禁止、open前/読取後の同bytes差替え・in-place変更・directory化・削除、symlink、POSIX FIFO。
- 実caller回帰: Zenn/note/PDF/Kindle/BOOTHの既存出力で同bytes manifestを差し替え、既存output・兄弟fileを維持して停止する。
- 既存のstaging差替え、cleanup失敗、rollback、再build決定性、visibility契約はfull testで再検証する。任意の並行実行を網羅したとはしない。
- 残件: mdBook独自I/Oの共通化判断、input snapshotの寿命、directory作成・親rename・backup内部の並行writer、OS別の強化/fallback設計。#138はこれらの採否と受入条件が揃うまでOpenを維持する。

実行済みOS・Node・exact head・CI結果と、依存audit等の独立blockerは実装PRとIssueへ記録します。局所I/O回帰の成功だけでrelease/consumer adoptionを承認しません。
