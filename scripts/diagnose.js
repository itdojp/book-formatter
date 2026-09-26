#!/usr/bin/env node

/**
 * Book Formatter Diagnostic Script
 * Comprehensive system health check and troubleshooting
 */

import { DiagnosticTool } from '../src/DiagnosticTool.js';
import path from 'path';
import { isDiagnosticEntryPoint, parseDiagnosticArguments } from '../src/DiagnosticContracts.js';

async function runDiagnostics() {
  const diagnostic = new DiagnosticTool();
  
  try {
    // Get project path from command line or use current directory
    const { projectPath, flags } = parseDiagnosticArguments(process.argv.slice(2), ['--export']);
    
    console.log(`📍 診断対象: ${projectPath}\n`);
    
    // Run all diagnostic checks
    const results = await diagnostic.runDiagnostics(projectPath);
    
    // Export results if requested
    if (flags.has('--export')) {
      const outputPath = path.join(projectPath, 'diagnostic-results.json');
      await diagnostic.exportResults(outputPath);
    }
    
    // Set exit code based on results
    if (results.criticalErrors > 0) {
      process.exit(2); // Critical errors
    } else if (results.errors > 0) {
      process.exit(1); // Regular errors
    } else {
      process.exit(0); // Success (warnings are OK)
    }
    
  } catch (error) {
    console.error('❌ 診断ツールの実行中にエラーが発生しました:', error.message);
    console.error(error.stack);
    process.exit(3);
  }
}

function printHelp() {
  console.log(`
Book Formatter 診断ツール

使用方法:
  npm run diagnose -- [プロジェクトパス] [オプション]

オプション:
  --export    診断結果をJSONファイルに出力
  --help, -h  このヘルプを表示

例:
  npm run diagnose
  npm run diagnose -- /path/to/book-project
  npm run diagnose -- --export
  npm run diagnose -- /path/to/project --export

終了コード:
  0: 成功（警告があっても正常）
  1: エラーあり
  2: 重大なエラーあり
  3: 診断ツール自体のエラー
`);
}

// Never interpret an importing program's argv or exit during module loading.
if (isDiagnosticEntryPoint(import.meta.url)) {
  const cliArgs = process.argv.slice(2);
  const separator = cliArgs.indexOf('--');
  const optionArgs = separator < 0 ? cliArgs : cliArgs.slice(0, separator);
  if (optionArgs.includes('--help') || optionArgs.includes('-h')) {
    printHelp();
  } else {
    runDiagnostics();
  }
}

export { runDiagnostics };
