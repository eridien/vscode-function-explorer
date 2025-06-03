import * as vscode from 'vscode';
import {minimatch} from 'minimatch';
import {glob}      from "glob";
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

let filesToInclude: string[] = ["**/*.js", "**/*.ts"];
let filesToExclude: string[] = ["node_modules/**"];

export function loadSettings() {
  const config = vscode.workspace.getConfiguration('function-marks');
  settings = {
    fileWrap:            config.get('fileWrap',            true),
    includeSubFunctions: config.get('includeSubFunctions', false),
  };
  filesToInclude = config.get<string>("filesToInclude", 
                       "**/*.js, **/*.ts").split(",").map(p => p.trim());
  filesToExclude = config.get<string>("filesToExclude", 
                        "node_modules/**").split(",").map(p => p.trim());
}

export function includeFile(fsPath: string): boolean {
  const filePath = vscode.workspace.asRelativePath(fsPath);
  const isInc    = filesToInclude.some(pattern => minimatch(filePath, pattern));
  const isExc    = filesToExclude.some(pattern => minimatch(filePath, pattern));
  return isInc && !isExc;
}

export async function getAllFiles(): Promise<string[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return [];
  const allMatches: string[] = [];
  for (const folder of workspaceFolders) {
    const folderPath = folder.uri.fsPath;
    for (const pattern of filesToInclude) {
      const matches = await glob(pattern, {
        cwd: folderPath,
        ignore: filesToExclude,
        absolute: true
      });
      allMatches.push(...matches);
    }
  }
  return allMatches;
}
