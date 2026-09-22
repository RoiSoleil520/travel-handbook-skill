# 项目规则

- 所有修改和提交仅在 `master` 分支进行，不创建其他分支或独立 Git worktree。
- 本项目不使用任何全局 skill；仅遵循项目规则和用户明确要求使用的项目级 skill。
- 仓库仅存放可分享的旅行手册 Skill 和公开示例，不加入私人攻略、实际订单、凭据、原网站私有代码或云服务配置。
- `docs/` 必须与 `travel-handbook/examples/trip.json` 和内置模板的生成结果保持同步。修改模板或示例后重新生成，保留 `docs/.nojekyll`。
- 提交前运行 `node travel-handbook/tests/check.mjs`。
