import vscode from 'vscode';
import path   from 'path';
const { log, start, end } = getLog('util');

function timeInSecs(ms: number): string {
  return (ms / 1000).toFixed(2);
}

const delaying: Map<string, NodeJS.Timeout> = new Map();
export function startDelaying(tag: string, delay = 300) {
  start(tag);
  if(delaying.has(tag)) {
    clearTimeout(delaying.get(tag));
    delaying.delete(tag);
  }
  delaying.set(tag, setTimeout(() => {
    delaying.delete(tag);
    end(tag);
  }, delay));
}
export function isDelaying(tag: string): boolean {
  return delaying.has(tag);
}

export function createSortKey(fsPath: string, lineNumber: number): string {
  return fsPath + "\x00" + lineNumber.toString().padStart(6, '0');
}

export function flashRange(editor: vscode.TextEditor, 
                           startPos: vscode.Position, 
                           endPos: vscode.Position, red = false) {
  const decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: red ? 'rgba(255,   0, 0, 0.05)' 
                         : 'rgba(255, 255, 0, 0.10)',
    borderRadius: '2px'
  });
  editor.setDecorations(decorationType, [new vscode.Range(startPos, endPos)]);
  setTimeout(() => {
    decorationType.dispose();
  }, 750);
}

export async function revealEditorByFspath(fsPath: string) {
  const uri    = vscode.Uri.file(fsPath);
  const editor = vscode.window.visibleTextEditors.find(
                        editor => editor.document.uri.fsPath === fsPath);
  if (editor) {
    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
  } else {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  }
}

const outputChannel = vscode.window.createOutputChannel('function-explorer');

export function getLog(module: string) : {
  log:   (...args: any[])                   => void;
  start: (name: string, hide?: boolean)     => void;
  end:   (name: string, onlySlow?: boolean, msg?: string) => void;
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

  const end = function (name: string, onlySlow: boolean = true, 
                        msg: string = ''): void {
    if (!timers[name]) {
      const line = `${module}: ${name} ended`;
      outputChannel.appendLine(line);
      console.log(line);
      return;
    }
    const endTime = Date.now();
    const duration = endTime - timers[name];
    if (onlySlow && duration < 100) return;
    const line = `${module}: ${name} ended, ${timeInSecs(duration)}s,  ${msg}`;
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
