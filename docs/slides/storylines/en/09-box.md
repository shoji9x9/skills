# 9. box

Message: Work with Box files through the API.

## Slides

1. The problem. You do not want to install an MCP server or SDK just so an agent can work with Box files. You want to use tokens and the client secret without leaving them in logs, output or
   the repository.
   Sources: the opening of `skills/box/SKILL.md` and "認証"
2. How to invoke. Ask "List the Box folder" or "Upload this to Box". It works with only `curl` and `jq`.
   Sources: `description` in `skills/box/SKILL.md` and the opening
3. Authentication. Choose between a Dev Token, which works right away, and OAuth refresh, which lasts longer. The refresh token changes on every use, so the script saves it. Secrets are
   never written to output.
   Sources: `skills/box/SKILL.md` "認証"
4. Target folder. The configuration key `root_folder_id` sets the folder the skill operates on. Put it in the repository configuration to share it with everyone, or in the `.local`
   configuration for yourself only.
   Sources: `skills/box/SKILL.md` "対象フォルダ"
5. What it can do. List folders, get metadata, download, search, upload, and upload a new version.
   Sources: `skills/box/SKILL.md` "レシピ"
6. Notes. After a write, read the item again to confirm the result. On rate limits, retry with increasing wait times. With access only through a shared link, add the `BoxApi` header. The
   skill is used on its own, so there is no "Related skills" slide.
   Sources: `skills/box/SKILL.md` "注意"
