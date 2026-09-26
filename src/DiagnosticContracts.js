import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'node:url';

export const FORMATTER_ROOT = fileURLToPath(new URL('../', import.meta.url));

function releaseTuple(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) return null;
  const tuple = match.slice(1).map(Number);
  return tuple.every(Number.isSafeInteger) ? tuple : null;
}

// Deliberately finite engines grammar, not a general-purpose SemVer parser.
export function matchesNodeEngine(version, range) {
  if (typeof range !== 'string') throw new Error('engines.node must be a string');
  const clauses = range.split('||').map(clause => {
    const match = /^(\^|>=)(\d+\.\d+\.\d+)$/.exec(clause.trim());
    const floor = match && releaseTuple(match[2]);
    if (!floor || (match[1] === '^' && floor[0] === 0)) {
      throw new Error(`Unsupported engines.node clause: ${clause.trim()}`);
    }
    return { operator: match[1], floor };
  });
  const current = typeof version === 'string' ? releaseTuple(version.replace(/^v/, '')) : null;
  if (!current) return false;
  return clauses.some(({ operator, floor }) => {
    const difference = current.map((part, index) => part - floor[index]).find(part => part !== 0) || 0;
    return difference >= 0 && (operator === '>=' || current[0] === floor[0]);
  });
}

export async function requireDiagnosticFile(root, relativePath) {
  let current = root;
  const parts = relativePath.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    const last = index === parts.length - 1;
    if (stat.isSymbolicLink() || (last ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`${relativePath}: regular file without symlink components required`);
    }
  }
  return current;
}

export async function detectDiagnosticTarget(projectPath) {
  const root = path.resolve(projectPath);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Target must be a real directory');
  // lstat, not pathExists: a dangling metadata symlink must not silently disappear.
  const has = async name => {
    try { await fs.lstat(path.join(root, name)); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  const standard = await has('book.yaml');
  const legacy = await has('book-config.json');
  let formatter = false;
  if (await has('package.json')) {
    const packageFile = await requireDiagnosticFile(root, 'package.json');
    const metadata = await fs.readJson(packageFile);
    formatter = metadata?.name === 'book-formatter';
  }
  const kinds = [standard && 'standard', legacy && 'legacy', formatter && 'formatter'].filter(Boolean);
  if (kinds.length !== 1) {
    throw new Error(kinds.length ? 'Ambiguous target metadata; select one project root' :
      'Unknown target: package.json name=book-formatter, book.yaml or book-config.json required');
  }
  return { root, kind: kinds[0] };
}

export function parseDiagnosticArguments(args, allowedFlags, cwd = process.cwd()) {
  const flags = new Set();
  let projectPath;
  let literal = false;
  for (const argument of args) {
    if (argument === '--' && !literal) { literal = true; continue; }
    if (!literal && argument.startsWith('-')) {
      if (!allowedFlags.includes(argument)) throw new Error(`Unknown option: ${argument}`);
      flags.add(argument);
    } else {
      if (projectPath !== undefined) throw new Error('Only one project path is allowed');
      projectPath = argument;
    }
  }
  return { projectPath: path.resolve(cwd, projectPath ?? '.'), flags };
}
