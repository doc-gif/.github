# .github

doc-gifのrepoで共通に使うファイルを置く。

- `pull_request_template.md`は、自分のテンプレートを持たないrepoが使う、PRの本文の型だ。
- `japanese-writing.md`は、AIが日本語で書くときの書き方を決める。規則、用語の言い換え、投稿前のチェックリストがある。
- `scripts/check-pr-body.mjs`は、PRの本文が`pull_request_template.md`の見出しをすべて埋めているかを確かめる。各repoは、`.github/workflows/check-pr-body.yml`を、このrepoの1つのcommitのSHAに固定して呼ぶ。テストは`node --test tests/*.test.mjs`で動かす。

各repoの呼ぶ側のファイルは、次の形にする。2か所の`<SHA>`には、同じcommitのSHAを書く。

```yaml
name: PR body
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
permissions:
  contents: read
jobs:
  pr-body:
    uses: doc-gif/.github/.github/workflows/check-pr-body.yml@<SHA>
    with:
      ref: <SHA>
```
