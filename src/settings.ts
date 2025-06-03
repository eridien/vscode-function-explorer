import * as vscode from 'vscode';
import {minimatch} from 'minimatch';
import * as utils  from './utils';
const {log} = utils.getLog('sett');

interface FunctionMarksSettings {
  fileWrap:            boolean;
  includeSubFunctions: boolean;
}

export let settings: FunctionMarksSettings = {
  fileWrap:            true,
  includeSubFunctions: false,
};

export function activate() {
  settings = getFunctionMarksSettings();
}

// function mm(val: number, max: number, min: number = 0): number {
//   return Math.max(min, Math.min(max, val));
// }

let filesToInclude: string[] = ["**/*.js", "**/*.ts"];
let filesToExclude: string[] = ["node_modules/**"];

function getFunctionMarksSettings(): FunctionMarksSettings {
  const config = vscode.workspace.getConfiguration('function-marks');
  filesToInclude = config.get<string>(
      "filesToInclude", "**/*.js, **/*.ts").split(",").map(p => p.trim());
  filesToExclude = config.get<string>(
      "filesToExclude", "node_modules/**").split(",").map(p => p.trim());
  return {
    fileWrap:            config.get('fileWrap',            true),
    includeSubFunctions: config.get('includeSubFunctions', false),
  };
}

export function refreshSettings() {
  settings = getFunctionMarksSettings();
}

export function includeDocument(fsPath: string): boolean {
  const filePath = vscode.workspace.asRelativePath(fsPath);
  const isInc    = filesToInclude.some(pattern => minimatch(filePath, pattern));
  const isExc    = filesToExclude.some(pattern => minimatch(filePath, pattern));
  return isInc && !isExc;
}

