/** 代码大纲（启发式）：按行抽取类 / 函数 / 方法，供源码浏览与内联编辑时的结构导航。
 *
 *  和 use-source-toc（md 标题）补成一对：md 用标题，代码用声明行；两者产出的都是 TocItem
 *  （id = 1-based 源码行号），共用同一个目录浮层与跳转方式。
 *
 *  **不做语义分析**：只认行首的声明形态，注释行/块注释跳过；
 *  多行注释里的关键字、宏、模板生成代码可能漏判或误判 —— 大纲只求"大致结构"。
 *  语言规则按扩展名分组，没规则的语言不出大纲（按钮自然不显示）。
 */
import { useEffect, useState } from 'react';
import type { TocItem } from './md-toc.js';

/** 注释行（行首形态）：// # -- ; % <!-- 以及块注释里以 * 开头的续行 */
const COMMENT_LINE = /^\s*(\/\/|#|--|;|%|<!--|\*)/;
/** 不是函数名的控制关键字（避免 if/for 之类被当成方法） */
const NOT_FUNCTION = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'do', 'else', 'try',
  'with', 'new', 'delete', 'typeof', 'await', 'yield', 'case', 'break', 'continue', 'throw',
]);

interface Hit {
  label: string;
  level: number;
}

/** 缩进决定层级：顶格 = 1（类/顶层函数），缩进 = 2（方法）。只分两级，够导航用了 */
function indentLevel(indent: string): number {
  return indent.length === 0 ? 1 : 2;
}

function pythonRule(line: string): Hit | null {
  const m = line.match(/^(\s*)(async\s+)?def\s+([A-Za-z_]\w*)/);
  if (m) return { label: `${m[2] ? 'async def' : 'def'} ${m[3]}`, level: m[1]!.length ? 2 : 1 };
  const c = line.match(/^(\s*)class\s+([A-Za-z_]\w*)/);
  if (c) return { label: `class ${c[2]}`, level: indentLevel(c[1]!) };
  return null;
}

function jsRule(line: string): Hit | null {
  let m = line.match(/^(\s*)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/);
  if (m) return { label: `class ${m[2]}`, level: indentLevel(m[1]!) };
  m = line.match(/^(\s*)(?:export\s+)?(?:declare\s+)?(interface|type|enum)\s+([A-Za-z_$][\w$]*)/);
  if (m) return { label: `${m[2]} ${m[3]}`, level: indentLevel(m[1]!) };
  m = line.match(/^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/);
  if (m) return { label: `function ${m[2]}`, level: indentLevel(m[1]!) };
  // 箭头函数常量： const foo = (a, b) => / const foo = async x =>
  m = line.match(/^(\s*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
  if (m) return { label: `const ${m[2]}`, level: indentLevel(m[1]!) };
  // 类内方法：foo(a, b) { / static async foo(): Promise<T> {
  m = line.match(/^(\s{2,})(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/);
  if (m && !NOT_FUNCTION.has(m[2]!)) return { label: `${m[2]}()`, level: 2 };
  return null;
}

function cRule(line: string): Hit | null {
  // 构造函数的初始化列表（`: QObject(parent)` / `, m_x(x)`）不是函数定义 ——
  // 不排除的话会被当成一个叫 QObject() 的函数收进大纲
  if (/^\s*[:,]/.test(line)) return null;
  let m = line.match(/^(\s*)(?:class|struct|union|enum)\s+([A-Za-z_]\w*)/);
  if (m && !/;\s*$/.test(line)) return { label: `${line.trim().split(/\s+/)[0]} ${m[2]}`, level: indentLevel(m[1]!) };
  m = line.match(/^(\s*)namespace\s+([A-Za-z_]\w*)/);
  if (m) return { label: `namespace ${m[2]}`, level: 1 };
  // 函数定义：可选返回类型 + 名字（可带 Class:: / Class::~ 前缀）+ 参数表；
  // 返回类型可省（构造函数、析构函数），行尾不结束于分号（分号是声明/调用）
  m = line.match(
    /^(\s*)(?:(?:[A-Za-z_][\w:*&<>,~]*)\s+)?((?:[A-Za-z_]\w*::)*[A-Za-z_~]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{?\s*$/,
  );
  // 全大写名字是宏（Qt 的 Q_UNUSED(x) / Q_PLUGIN_METADATA(...) 常常不带分号），不是函数
  if (m && !NOT_FUNCTION.has(m[2]!) && !/^[A-Z0-9_]+$/.test(m[2]!) && !/;\s*$/.test(line)) {
    return { label: `${m[2]}()`, level: indentLevel(m[1]!) };
  }
  return null;
}

/** Java / C#：类与方法（方法要求带访问修饰符，避免把 if(...) 之类收进来） */
function javaRule(line: string): Hit | null {
  const ns = line.match(/^(\s*)namespace\s+([A-Za-z_][\w.]*)/);
  if (ns) return { label: `namespace ${ns[2]}`, level: 1 };
  let m = line.match(/^(\s*)(?:(?:public|private|protected|static|final|abstract|sealed|data|open|internal|partial|record)\s+)*(class|interface|enum|record|object)\s+([A-Za-z_]\w*)/);
  if (m) return { label: `${m[2]} ${m[3]}`, level: indentLevel(m[1]!) };
  m = line.match(/^(\s+)(?:(?:public|private|protected|static|final|abstract|synchronized|native|virtual|override|async|internal|open|suspend|const|extern|unsafe)\s+)+(?:(?:[\w<>,.?]|\[\])+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?::\s*[^{]+)?\{?\s*$/);
  if (m && !NOT_FUNCTION.has(m[2]!)) return { label: `${m[2]}()`, level: 2 };
  return null;
}

function kotlinRule(line: string): Hit | null {
  let m = line.match(/^(\s*)(?:(?:public|private|internal|protected|open|override|suspend|inline|operator|tailrec|abstract|final|external)\s+)*fun\s+(?:<[^>]*>\s*)?(?:\w+\.)?([A-Za-z_]\w*)/);
  if (m) return { label: `fun ${m[1]}`, level: indentLevel(m[1]!) };
  m = line.match(/^(\s*)(?:(?:public|private|internal|protected|open|abstract|sealed|data|enum|inline|value|annotation)\s+)*(class|interface|object)\s+([A-Za-z_]\w*)/);
  if (m) return { label: `${m[2]} ${m[3]}`, level: indentLevel(m[1]!) };
  return null;
}

function goRule(line: string): Hit | null {
  const m = line.match(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/);
  if (m) return { label: `func ${m[1]}`, level: /^func\s+\(/.test(line) ? 2 : 1 };
  const t = line.match(/^type\s+([A-Za-z_]\w*)\s*(struct|interface)?/);
  if (t) return { label: `type ${t[1]}`, level: 1 };
  return null;
}

function rustRule(line: string): Hit | null {
  let m = line.match(/^(\s*)(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/);
  if (m) return { label: `fn ${m[2]}`, level: indentLevel(m[1]!) };
  m = line.match(/^(\s*)(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|impl|mod)\s+([A-Za-z_]\w*)/);
  if (m) return { label: `${m[2]} ${m[3]}`, level: indentLevel(m[1]!) };
  return null;
}

function phpRule(line: string): Hit | null {
  let m = line.match(/^(\s*)(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+([A-Za-z_]\w*)/);
  if (m) return { label: `function ${m[2]}`, level: indentLevel(m[1]!) };
  m = line.match(/^(\s*)(?:abstract\s+|final\s+)?(class|interface|trait)\s+([A-Za-z_]\w*)/);
  if (m) return { label: `${m[2]} ${m[3]}`, level: indentLevel(m[1]!) };
  return null;
}

function rubyRule(line: string): Hit | null {
  let m = line.match(/^(\s*)def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/);
  if (m) return { label: `def ${m[2]}`, level: indentLevel(m[1]!) };
  m = line.match(/^(\s*)(class|module)\s+([A-Za-z_][\w:]*)/);
  if (m) return { label: `${m[2]} ${m[3]}`, level: indentLevel(m[1]!) };
  return null;
}

function swiftRule(line: string): Hit | null {
  let m = line.match(/^(\s*)(?:(?:public|private|internal|open|fileprivate|final|static|class|override|mutating|async|@\w+)\s+)*func\s+([A-Za-z_]\w*)/);
  if (m) return { label: `func ${m[2]}`, level: indentLevel(m[1]!) };
  m = line.match(/^(\s*)(?:(?:public|private|internal|open|final)\s+)*(class|struct|enum|protocol|extension)\s+([A-Za-z_]\w*)/);
  if (m) return { label: `${m[2]} ${m[3]}`, level: indentLevel(m[1]!) };
  return null;
}

function dartRule(line: string): Hit | null {
  let m = line.match(/^(\s*)(?:abstract\s+)?(class|mixin|enum|extension|typedef)\s+([A-Za-z_]\w*)/);
  if (m) return { label: `${m[2]} ${m[3]}`, level: indentLevel(m[1]!) };
  m = line.match(/^(\s{2,})(?:static\s+)?(?:[\w<>?,\s]+\s+)?([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:async\s*)?\{\s*$/);
  if (m && !NOT_FUNCTION.has(m[2]!)) return { label: `${m[2]}()`, level: 2 };
  return null;
}

function scalaRule(line: string): Hit | null {
  const m = line.match(/^(\s*)(?:(?:private|protected|override|final|implicit|sealed|lazy|case)\s+)*(def|class|object|trait)\s+([A-Za-z_]\w*)/);
  if (m) return { label: `${m[2]} ${m[3]}`, level: indentLevel(m[1]!) };
  return null;
}

function bashRule(line: string): Hit | null {
  let m = line.match(/^(\s*)function\s+([A-Za-z_][\w-]*)/);
  if (m) return { label: `${m[2]}()`, level: 1 };
  m = line.match(/^(\s*)([A-Za-z_][\w-]*)\s*\(\s*\)\s*\{?/);
  if (m && !NOT_FUNCTION.has(m[2]!)) return { label: `${m[2]}()`, level: 1 };
  return null;
}

/** 扩展名 → 规则；没列到的语言不出大纲 */
const RULES: Record<string, (line: string) => Hit | null> = {
  py: pythonRule, pyw: pythonRule,
  js: jsRule, jsx: jsRule, mjs: jsRule, cjs: jsRule, ts: jsRule, tsx: jsRule,
  c: cRule, h: cRule, cpp: cRule, hpp: cRule, cc: cRule, cxx: cRule, hh: cRule, hxx: cRule,
  java: javaRule, cs: javaRule,
  kt: kotlinRule, kts: kotlinRule,
  go: goRule, rs: rustRule, php: phpRule, rb: rubyRule, rake: rubyRule,
  swift: swiftRule, dart: dartRule, scala: scalaRule, sc: scalaRule,
  sh: bashRule, bash: bashRule, zsh: bashRule,
};

/** 纯函数：按扩展名选规则，扫一遍源码产出大纲条目（id = 源码行号） */
export function sourceOutlineOf(text: string, fileName: string): TocItem[] {
  const rule = RULES[fileName.split('.').pop()?.toLowerCase() ?? ''];
  if (!rule) return [];
  const items: TocItem[] = [];
  let inBlockComment = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // 块注释（/* … */）跨行：整段跳过，免得把注释里的 def/function 收进大纲
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (/^\s*\/\*/.test(line)) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    if (!line.trim() || COMMENT_LINE.test(line)) continue;
    const hit = rule(line);
    if (hit) items.push({ level: hit.level, text: hit.label, id: String(i + 1) });
  }
  return items;
}

/** 组件用：防抖解析（编辑态每次击键都全文件扫会卡，尤其大文件；停手 200ms 再算） */
export function useSourceOutline(text: string, fileName: string, enabled: boolean): TocItem[] {
  const [items, setItems] = useState<TocItem[]>([]);
  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }
    const timer = setTimeout(() => setItems(sourceOutlineOf(text, fileName)), 200);
    return () => clearTimeout(timer);
  }, [text, fileName, enabled]);
  return items;
}
