import vscode from 'vscode';
const { log, start, end } = getLog('util');

export function createSortKey(fsPath: string, lineNumber: number): string {
  return fsPath + "\x00" + lineNumber.toString().padStart(6, '0');
}

export function flashRange(editor: vscode.TextEditor, 
                           startLine: number, 
                           endLine: number, red = false) {
  const ranges: vscode.Range[] = [];
  for (let line = startLine; line <= endLine; line++) 
    ranges.push(new vscode.Range(line, 0, line, 1));
  const decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: red ? 'rgba(255,   0, 0, 0.20)' 
                         : 'rgba(255, 255, 0, 0.30)',
  });

  editor.setDecorations(decorationType, ranges);
  setTimeout(() => {
    decorationType.dispose();
  }, 750);
}

export async function revealEditorByFspath(fsPath: string):
                                 Promise<vscode.TextEditor | undefined> {
  const uri  = vscode.Uri.file(fsPath);
  let editor = vscode.window.visibleTextEditors.find(
                        editor => editor.document.uri.fsPath === fsPath);
  if (!editor) {
    const document = await vscode.workspace.openTextDocument(uri);
    editor = await vscode.window.showTextDocument(document, {preview: true});
  }
  return editor;
}

export function findMiddleOfText(code: string): number {
  const blankLineRegex = /^\s*$(?:\r?\n|$)/gm;
  const middleIdx = Math.floor(code.length / 2);
  let match;
  let minDist = code.length;
  let closest = -1;
  while ((match = blankLineRegex.exec(code)) !== null) {
    const idx  = match.index;
    const dist = Math.abs(idx - middleIdx);
    if (dist < minDist) {
      minDist = dist;
      closest = idx;
    } else if (dist > minDist) break;
  }
  return closest;
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

  const end = function (name: string, onlySlow: boolean = false, 
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
    // const line = `${module}: ${name} ended, ${timeInSecs(duration)}s,  ${msg}`;
    const line = `${module}: ${name} ended, ${duration}ms  ${msg}`;
    outputChannel.appendLine(line);
    console.log(line);
  };

  const log = function (...args: any[]): void {
    let errFlag    = false;
    let errMsgFlag = false;
    let infoFlag   = false;
    let nomodFlag  = false;

    if (typeof args[0] === 'string') {
      errFlag = args[0].includes('err');
      infoFlag = args[0].includes('info');
      nomodFlag = args[0].includes('nomod');
      errMsgFlag = args[0].includes('errmsg');
    }

    if (errFlag || infoFlag || nomodFlag || errMsgFlag) args = args.slice(1);

    let errMsg: string | undefined;
    if (errMsgFlag) {
      errMsg  = args[0]?.message + ' -> ';
      args    = args.slice(1);
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

    const infoLine = par.join(' ').replace('parse: ','');

    outputChannel.appendLine(line);
    if (errFlag) console.error(line);
    else console.log(line);
    if (infoFlag) vscode.window.showInformationMessage(infoLine);
  };

  return { log, start, end };
}
