import * as vscode from 'vscode';
import * as utils  from './utils';
const {log} = utils.getLog('sett');

export let settings = getFunctionMarkSettings();

interface FunctionMarkSettings {
  fileWrap:            boolean;
  includeSubFunctions: boolean;
  includeClasses:      boolean;
}

function mm(val: number, max: number, min: number = 0): number {
  return Math.max(min, Math.min(max, val));
}

function getFunctionMarkSettings(): FunctionMarkSettings {
  const config = vscode.workspace.getConfiguration('function-marks');
  return {
    fileWrap:        config.get('fileWrap',       true),
    includeSubFunctions:    config.get('includeSubFunctions',   false),
    includeClasses:  config.get('includeClasses', true),
  };
}

export function refreshSettings() {
  settings = getFunctionMarkSettings();
}