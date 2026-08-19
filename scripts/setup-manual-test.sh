#!/bin/bash
# 手动测试项目准备脚本：/tmp/svnkit-test/manual-test/
# 生成 git + svn 各一个演示仓库（含提交历史/各类状态/分支/标签），供用户在工具里手动测试
set -euo pipefail

BASE=/tmp/svnkit-test/manual-test
rm -rf "$BASE"
mkdir -p "$BASE"

echo "=============================================="
echo "准备 Git 测试项目: manual-git"
echo "=============================================="
mkdir -p "$BASE/manual-git/src" "$BASE/manual-git/docs"
cd "$BASE/manual-git"
git init -q
git config user.email demo@test.local
git config user.name demo

# 提交 1：初始
cat > README.md << 'EOF'
# 演示项目 manual-git

这是一个用于手动测试的 Git 演示项目。
包含代码、文档、中文文件名等。
EOF
cat > src/main.ts << 'EOF'
// 演示入口
export function greet(name: string): string {
  return `你好, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

const result = add(1, 2);
console.log(greet("世界"), result);
EOF
cat > src/utils.ts << 'EOF'
// 工具函数
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
EOF
cat > docs/使用说明.md << 'EOF'
# 使用说明

1. 运行 `npm start`
2. 打开浏览器
3. 开始使用
EOF
git add -A && git commit -qm "初始提交：项目框架"

# 提交 2：添加功能
cat >> src/main.ts << 'EOF'

export function multiply(a: number, b: number): number {
  return a * b;
}
EOF
echo "node_modules/" > .gitignore
git add -A && git commit -qm "添加 multiply 功能与 .gitignore"

# 提交 3：优化
cat >> src/main.ts << 'EOF'

export function version(): string {
  return '0.1.0';
}
EOF
git add -A && git commit -qm "添加版本信息"

# 当前工作区状态：M / ? / D / 已暂存 A
echo "// 正在开发的新功能" >> src/main.ts                                    # M 已修改
echo "开发中..." > src/new-feature.ts                                       # ? 未版本化
echo "旧文件" > old.txt && git add old.txt && git commit -qm "添加 old.txt" # 造删除目标
rm old.txt                                                                   # D 已删除（工作区）
echo "staged" > staged.txt && git add staged.txt                             # A 已暂存

# 分支与标签
git branch feature-x
git tag v0.1

echo ""
echo "=============================================="
echo "准备 SVN 测试项目: manual-svn"
echo "=============================================="
svnadmin create "$BASE/manual-svn-repo"
svn checkout -q "file://$BASE/manual-svn-repo" "$BASE/manual-svn-wc"
cd "$BASE/manual-svn-wc"

# r1：初始
mkdir -p src docs
cat > README.md << 'EOF'
# 演示项目 manual-svn

这是一个用于手动测试的 SVN 演示项目。
EOF
cat > src/main.c << 'EOF'
/* 演示入口 */
#include <stdio.h>

int add(int a, int b) { return a + b; }

int main(void) {
    printf("hello svn: %d\n", add(1, 2));
    return 0;
}
EOF
cat > docs/说明.txt << 'EOF'
SVN 演示说明
1. svn update
2. 修改代码
3. svn commit
EOF
svn add -q README.md src docs
svn commit -qm "初始提交：项目框架"

# r2：添加功能
cat >> src/main.c << 'EOF'

int multiply(int a, int b) { return a * b; }
EOF
svn commit -qm "添加 multiply 功能"

# r3：优化 + 中文文件名
cat > docs/中文文档.md << 'EOF'
# 中文文档
中文文件名与内容支持演示。
EOF
svn add -q docs/中文文档.md
svn commit -qm "添加中文文档"

# 当前工作区状态：M / ? / D(计划删除) / !(缺失)
echo "/* 本地修改 */" >> src/main.c                          # M 已修改
echo "开发笔记" > note.txt                                    # ? 未版本化
svn delete -q old.c 2>/dev/null || true
echo "old" > old.c && svn add -q old.c && svn commit -qm "添加 old.c" && svn delete -q old.c   # D 计划删除
echo "x" > lost.c && svn add -q lost.c && svn commit -qm "添加 lost.c" && rm -f lost.c          # ! 缺失

# 分支（先提交 branches 目录，再按分支前版本远程复制，避免嵌套）
svn mkdir -q branches
svn commit -qm "创建 branches 目录"
REPO="file://$BASE/manual-svn-repo"
CUR_REV=$(svn info | grep '^版本:' | awk '{print $2}')
svn copy -r "$CUR_REV" "$REPO" "$REPO/branches/dev" -m "创建开发分支 dev"

# 忽略规则示例
svn propset svn:ignore $'*.o\nbuild/' .

echo ""
echo "=============================================="
echo "✅ 测试项目就绪！"
echo "=============================================="
echo ""
echo "Git 测试项目:  $BASE/manual-git"
echo "  - 状态: M(main.ts) / ?(new-feature.ts) / D(old.txt) / A(staged.txt)"
echo "  - 分支: master + feature-x    标签: v0.1"
echo "  - 提交历史: 4 条"
echo ""
echo "SVN 测试项目:  $BASE/manual-svn-wc"
echo "  - 状态: M(main.c) / ?(note.txt) / D(old.c) / !(lost.c)"
echo "  - 分支: dev（branches/）      忽略规则: *.o build/"
echo "  - 提交历史: r1-r5"
echo ""
echo "工具里打开方法："
echo "  ./svn-git文件版本管理-1.0.0.AppImage"
echo "  然后「📂 打开项目」→ 输入路径 → $BASE/manual-git 或 $BASE/manual-svn-wc"
