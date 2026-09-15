/**
 * Path to Shiki grammar.
 *
 * Each entry is a dynamic import so the bundler emits one chunk per grammar
 * and a session only ever fetches the languages it actually looked at. The
 * import specifiers are literal strings for exactly that reason — a computed
 * specifier defeats the analysis and pulls every grammar into the bundle.
 *
 * Grammars range from about 4 KB (JSON) to 190 KB (TypeScript), so the list is
 * broad but curated rather than the whole Shiki bundle.
 */

type Loader = () => Promise<{ default: unknown }>;

const GRAMMARS: Record<string, Loader> = {
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  elixir: () => import('shiki/langs/elixir.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  groovy: () => import('shiki/langs/groovy.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  nix: () => import('shiki/langs/nix.mjs'),
  'objective-c': () => import('shiki/langs/objective-c.mjs'),
  perl: () => import('shiki/langs/perl.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  zig: () => import('shiki/langs/zig.mjs'),
};

const BY_EXTENSION: Record<string, string> = {
  bash: 'shellscript',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cs: 'csharp',
  css: 'css',
  cpp: 'cpp',
  cxx: 'cpp',
  dart: 'dart',
  diff: 'diff',
  ex: 'elixir',
  exs: 'elixir',
  go: 'go',
  gradle: 'groovy',
  graphql: 'graphql',
  gql: 'graphql',
  groovy: 'groovy',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  m: 'objective-c',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  nix: 'nix',
  patch: 'diff',
  php: 'php',
  pl: 'perl',
  pm: 'perl',
  ps1: 'powershell',
  py: 'python',
  pyi: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  sass: 'scss',
  scala: 'scala',
  scss: 'scss',
  sh: 'shellscript',
  sql: 'sql',
  svelte: 'svelte',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zig: 'zig',
  zsh: 'shellscript',
};

/** Files whose name, not extension, identifies them. */
const BY_FILENAME: Record<string, string> = {
  '.bashrc': 'shellscript',
  '.zshrc': 'shellscript',
  dockerfile: 'dockerfile',
  gemfile: 'ruby',
  makefile: 'make',
  rakefile: 'ruby',
};

/**
 * The grammar to use for a path, or null when we have none — in which case the
 * file renders uncoloured rather than guessed at.
 */
export function languageForPath(path: string): string | null {
  const name = (path.split('/').pop() ?? '').toLowerCase();

  const byName = BY_FILENAME[name];
  if (byName !== undefined) return byName;

  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;

  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

export function grammarLoader(language: string): Loader | undefined {
  return GRAMMARS[language];
}
