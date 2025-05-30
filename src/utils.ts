import vscode     from 'vscode';
const { log } = getLog('util');

const  zeroWidthChars    =  ['\u200B', '\u200C', '\u200D', '\u2060'];
export const oneInvChar  = '['  + zeroWidthChars.join('') + ']';
export const notInvChar  = '[^' + zeroWidthChars.join('') + ']';
export const invChrRegEx = new RegExp(oneInvChar, 'g');
export const bannerRegx  = new RegExp(`^\\s*?//(${oneInvChar}{6})${notInvChar}*$`);

export function invBase4ToVisStr(str:String) {
  const digitMap: { [key: string]: string } = {
    '\u200B': '0', // Zero Width Space
    '\u200C': '1', // Zero Width Non-Joiner
    '\u200D': '2', // Zero Width Joiner
    '\u2060': '3'  // Word Joiner
  };
  let digitsStr = '';
  for (const char of str) {
    let digit = digitMap[char];
    if (digit === undefined) digit = '?';
    digitsStr += digit;
  }
  return digitsStr;
}

export function num2inv(num: number): string {
  return zeroWidthChars[num] ?? '?';
}

export function inv2num(char: string): number {
  const digitMap: { [key: string]: number } = 
                { '\u200B': 0, '\u200C': 1, '\u200D': 2, '\u2060': 3 };
  return digitMap[char] ?? 0;
}

export function numberToInvBase4(num :number, width = 99) {
  let digitsStr = '';
  if (num === 0) digitsStr = zeroWidthChars[0];
  else {
    let result = '';
    while (num > 0) {
      const digit = num % 4;
      result = zeroWidthChars[digit] + result;
      num = Math.floor(num / 4);
    }
    digitsStr = result;
  }
  if (digitsStr.length > width) {
    const randomNum = Math.floor(Math.random() * Math.pow(4, width));
    log('err', `numberToInvBase4 num:${num} ` +
               `width:${digitsStr.length} too big, max is ${width}, ` +
               `using random number ${randomNum}`);
    return numberToInvBase4(randomNum, width);
  }
  if(width < 99) digitsStr = digitsStr.padStart(width, zeroWidthChars[0]);
  return digitsStr;
}

export function invBase4ToNumber(str: string) {
  const digitMap : { [key: string]: number } = 
               { '\u200B': 0, '\u200C': 1, '\u200D': 2, '\u2060': 3 };
  let num = 0;
  for (const char of str) {
    const digit = digitMap[char];
    if (digit === undefined) {
      log('err', `Invalid character '${char}' in zero-width base-4 string`);
      return 0;
    }
    num = num * 4 + digit;
  }
  return num;
}

let lastIdNumber = 0;

export function getIdStr(): string {
  return numberToInvBase4(++lastIdNumber, 6);
}

export function initIdNumber(document: vscode.TextDocument) {
  lastIdNumber  = 0;
  const docText = document.getText();
  const matches = [...docText.matchAll(idRegEx)];
  for(const match of matches) {
    const num = invBase4ToNumber(match[1]);
    lastIdNumber = Math.max(num, lastIdNumber);
  }
}

function timeInSecs(ms: number): string {
  return (ms / 1000).toFixed(2);
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
