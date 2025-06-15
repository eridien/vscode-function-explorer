import vscode     from 'vscode';
const { log } = getLog('util');

function timeInSecs(ms: number): string {
  return (ms / 1000).toFixed(2);
}

export function createSortKey(fsPath: string, lineNumber: number): string {
  return fsPath + "\x00" + lineNumber.toString().padStart(6, '0');
}

export function rangesOverlap(start1: number, end1: number, 
                              start2: number, end2: number): boolean {
  if (start1 > end1) [start1, end1] = [end1, start1];
  if (start2 > end2) [start2, end2] = [end2, start2];
  return start1 <= end2 && start2 <= end1;
}

export function scrollToMarginTop(editor: vscode.TextEditor, 
                                  lineNum: number, margin: number) {
  const visibleRanges = editor.visibleRanges;
  lineloop:
  for(; lineNum > 0; lineNum--) {
    if(--margin < 0) break;
    vrloop:
    for (const vr of visibleRanges) {
      while(rangesOverlap(vr.start.line, vr.end.line, lineNum, lineNum)) {
        if(--lineNum == 0) break lineloop;
        break vrloop;
      }
    } 
  }
  const position = new vscode.Position(lineNum, 0);
  const range = new vscode.Range(position, position);
  editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
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
