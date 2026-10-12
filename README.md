# .github

doc-gifのrepoで共通に使うファイルを置く。

- `pull_request_template.md`は、自分のテンプレートを持たないrepoが使う、PRの本文の型だ。
- `japanese-writing.md`は、AIが日本語で書くときの書き方を決める。規則、用語の言い換え、投稿前のチェックリストがある。
- `scripts/check-pr-body.mjs`は、PRの本文が`pull_request_template.md`の見出しをすべて埋めているかを確かめる。各repoのworkflowは、このrepoを決まったSHAでcheckoutして動かす。試験は`node --test tests/*.test.mjs`。
