import vscode     from 'vscode';
const { log } = getLog('util');

function timeInSecs(ms: number): string {
  return (ms / 1000).toFixed(2);
}

export async function fileExists(path:string) {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(path));
    return true;
  } catch (_err) {
    return false;
  }
}

export function getRelPath(wsFolder: vscode.WorkspaceFolder, 
                           uri:      vscode.Uri): string {
  const wsPath = wsFolder.uri.path;
  let relPath  = uri.path.startsWith(wsPath)
               ? uri.path.slice(wsPath.length)
               : uri.path;
  if (relPath.startsWith('/')) relPath = relPath.slice(1);
  return relPath;
}

export function createSortKey(fsPath: string, lineNumber: number): string {
  return fsPath + "\x00" + lineNumber.toString().padStart(6, '0');
}

const outputChannel = vscode.window.createOutputChannel('function-marks');

export function getLog(module: string) : {
  log:   (...args: any[])                   => void;
  start: (name: string, hide?: boolean)     => void;
  end:   (name: string, onlySlow?: boolean) => void;
} {
  const timers: Record<string, number> = {};

  const start = function (name: string, hide?: boolean): void {
    const startTime = Date.now();
    timers[name] = startTime;
    if (hide) return;
    const line = `${module}: ${name} started`;
    outputChannel.appendLine(line);
    console.log(line);
  };

  const end = function (name: string, onlySlow: boolean = true): void {
    if (!timers[name]) {
      const line = `${module}: ${name} ended`;
      outputChannel.appendLine(line);
      console.log(line);
      return;
    }
    const endTime = Date.now();
    const duration = endTime - timers[name];
    if (onlySlow && duration < 100) return;
    const line = `${module}: ${name} ended, ${timeInSecs(duration)}s`;
    outputChannel.appendLine(line);
    console.log(line);
  };

  const log = function (...args: any[]): void {
    let errFlag = false;
    let errMsgFlag = false;
    let infoFlag = false;
    let nomodFlag = false;

    if (typeof args[0] === 'string') {
      errFlag = args[0].includes('err');
      infoFlag = args[0].includes('info');
      nomodFlag = args[0].includes('nomod');
      errMsgFlag = args[0].includes('errmsg');
    }

    if (errFlag || infoFlag || nomodFlag || errMsgFlag) args = args.slice(1);

    let errMsg: string | undefined;
    if (errMsgFlag) {
      errMsg = args[0]?.message + ' -> ';
      args = args.slice(1);
      errFlag = true;
    }

    const par = args.map((a) => {
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a, null, 2);
        } catch (e: any) {
          return JSON.stringify(Object.keys(a)) + e.message;
        }
      } else return a;
    });

    const line = (nomodFlag ? '' : module + ': ') +
                 (errFlag ? ' error, ' : '') +
                 (errMsg !== undefined ? errMsg : '') +
                 par.join(' ');

    const infoLine = par.join(' ')
                        .replace('parse: ','');

    outputChannel.appendLine(line);
    if (errFlag) console.error(line);
    else console.log(line);
    if (infoFlag) vscode.window.showInformationMessage(infoLine);
  };

  return { log, start, end };
}
