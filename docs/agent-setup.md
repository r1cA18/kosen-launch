# エージェントから作品を作る

Webでアカウントを作成し、設定のAgentタブで接続方法を選ぶ。接続方法は3つある。どれも権限は同じで、作品の下書き作成と更新案と画像の送信に限る。公開とアカウント管理はWebで本人が行う。

## Claude（Web・Desktop）

claude.aiとClaude Desktopはカスタムコネクタで接続する。Claude Codeを使わない利用者向けの標準の方法。

1. Claudeで「Customize」→「Connectors」→「Add custom connector」を開く
2. URLに`<APP_ORIGIN>/mcp`を入れる
3. OAuth clientを選ぶ画面では「Register automatically」（Dynamic Client Registration）を選ぶ
4. 「Connect」を押す。Kosen Launchにログインし、確認画面で「許可」を押す
5. Agentタブから`kosen-portfolio-skill.zip`をダウンロードし、「Customize」→「Skills」でアップロードしてオンにする

ClaudeはAnthropicのクラウド（`160.79.104.0/21`）から接続するため、`APP_ORIGIN`はHTTPSの公開URLにする。`http://127.0.0.1:4177`などのローカルURLはclaude.aiから届かない。ローカルではClaude CodeのHTTP接続で同じ流れを試せる。

claude.aiでは手元のフォルダを直接読めないため、資料と画像は会話に添付する。画像は`upload_image`へbase64で送り、2MB以内のPNG・JPEG・WebPに限る。モデルが文字として出力するため、数百KB程度に縮小して送る。送れない画像はWebの編集画面から追加する。

接続は設定のAgentタブに「Claude（コネクタ）」として表示され、「接続を解除」で即座に止まる。アクセストークンは1時間、更新トークンは30日で、Claudeが自動で更新する。30日使わなければ再接続が必要になる。

## Claude Code

同じ`/mcp`にHTTPで接続する。

```sh
claude mcp add --transport http kosen-launch <APP_ORIGIN>/mcp
```

Claude Codeで`/mcp`を開き、`kosen-launch`を選んで認証する。ブラウザーで同意すると接続される。OAuthを使わない場合は、Agentタブで連携トークンを発行してヘッダーに設定する。

```sh
claude mcp add --transport http kosen-launch <APP_ORIGIN>/mcp --header "Authorization: Bearer <連携トークン>"
```

Skillは`SKILL.md`をダウンロードして`~/.claude/skills/kosen-portfolio/SKILL.md`へ置く。

## その他のエージェント（stdio）

Agentタブで連携トークンを発行する。初期版は7日間有効。解除すると即座に利用できなくなる。利用するエージェントのMCP設定に次のstdioサーバーを追加する。`args`は手元のリポジトリの絶対パスへ置き換える。トークンはローカルの非共有設定へ保存しGitへ入れない。

```json
{
  "mcpServers": {
    "kosen-launch": {
      "command": "bun",
      "args": ["/path/to/kosen-launch/src/mcp.ts"],
      "env": {
        "KOSEN_LAUNCH_URL": "http://127.0.0.1:4177",
        "KOSEN_LAUNCH_TOKEN": "発行した連携トークン"
      }
    }
  }
}
```

これはJSON形式の接続例。ホストがTOMLなど別形式を使う場合は同じcommand・args・envをその形式へ設定する。Bunはホストから実行できる必要がある。HTTPはlocalhostだけに対応する。外部サービスへ接続する際はHTTPSを使う。stdioの`upload_image`はローカルの`file_path`（5MB以内）とbase64の`data`（2MB以内）のどちらも受け付ける。

## Skill

`skills/kosen-portfolio/SKILL.md`が配布用の正本。Webからは`/downloads/kosen-portfolio-skill.md`と、claude.ai向けに`kosen-portfolio/SKILL.md`を含む`/downloads/kosen-portfolio-skill.zip`を配る。MCPサーバーはMCP Skills拡張（SEP-2640、`io.modelcontextprotocol/skills`）でも同じSkillを返す。この拡張を読むホストではコネクタの追加だけでSkillも届く。claude.aiとClaude Codeが拡張を読むかは未確認のため、zipとSKILL.mdの配布を併用する。

依頼例：

> この制作フォルダからKosen Launchの作品下書きを作って。配布された課題と自分の担当を分けて。不明なところは質問して。

## 利用できる操作

| MCPツール             | 役割                               |
| --------------------- | ---------------------------------- |
| get_authoring_rules   | 共通Schemaと文章のルールを取得     |
| get_profile           | 本人のhandleと表示名を取得         |
| list_works / get_work | 本人の作品と最新版を取得           |
| upload_image          | 選択した画像をパスかbase64で送信   |
| create_work_draft     | source_keyで重複を防いで下書き作成 |
| propose_work_changes  | 既存の下書きを変更せず更新案を送信 |
| prepare_publication   | Webの確認画面へ誘導                |

Webでは更新案の採用・見送りと直接編集ができる。採用後も公開済みの内容は変わらない。公開前の確認画面から選んだ版を公開する。本人の担当を中心とした共通UIに当てはめるため任意のHTMLやJavaScriptは受け取らない。

## 初期版の範囲

stdioとStreamable HTTPのMCP接続はSDKの実クライアントで検証済み。Claude CodeのHTTP接続はトークンヘッダーで実際にツールを呼べることを確認済み。claude.aiとClaude DesktopのOAuth接続は公開URLでの確認が必要。現時点ではこれらのグローバル設定を自動変更しない。

## 担当が明記されていない資料

Skillは質問の前にREADMEと担当表と個人報告と成果物と対象パスの履歴を照合する。計画と実績と他班への依頼を区別する。判断理由と未確認事項は`assessment`へ保存され本人のレビュー画面に表示される。資料だけでは確定できない担当は推定と明記するか担当未確認に残す。

利用者は「このフォルダから作品ごとに整理して、担当表と個人報告と成果物から自分の担当も調べてください。既存作品は更新案にしてください」と依頼できる。根拠を示さず全てを本人の担当とする生成は採用しない。
