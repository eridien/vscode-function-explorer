import * as vscode                         from 'vscode';
import path                                from 'path';
import {langs}                             from './languages';
import { Tree, QueryCapture, 
         Parser, Language, Query }         from 'web-tree-sitter';
import * as utils                          from './utils';
const {log, start, end} = utils.getLog('pars');

const PARSE_DUMP_TYPE: string = '';  
const PARSE_DUMP_NAME: string = '';
const PARSE_DEBUG_STATS = true;
const CONTEXT_LENGTH    = 30;

let context: vscode.ExtensionContext;
type SyntaxNode = NonNullable<ReturnType<Parser['parse']>>['rootNode'];

export async function activate(contextIn: vscode.ExtensionContext) {
  context = contextIn;
  await Parser.init();
}

const languageCache: Map<string, Language> = new Map();

async function getLangFromWasm(lang:string) {
  if(languageCache.has(lang)) return languageCache.get(lang);
  const absPath = context?.asAbsolutePath(`wasm/tree-sitter-${lang}.wasm`);
  if(!absPath) {
    log('infoerr', `Function Explorer: Language ${lang} not supported.`);
    return null;
  }
  const wasmUri  = vscode.Uri.file(absPath);
  const language = await Language.load(wasmUri.fsPath);
  languageCache.set(lang, language);
  return language;
}

export interface NodeData {
  name:         string;
  funcId:       string;
  type:         string;
  start:        number;
  startName:    number;
  endName:      number;
  end:          number;
  lang:         string;
}

function parseDebug(rootNode: SyntaxNode) {
  let dumping    = false;
  let depth      = 0;
  let firstDepth = 0;
  let lineCount  = 0;
  let done       = false;
  function walkTree(node: SyntaxNode, visit: (node: SyntaxNode) => void) {
    visit(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && !done) {
        depth++;
        walkTree(child, visit);
        if(--depth < firstDepth) done = true;
      }
    }
  }
  walkTree(rootNode, node => {
    let name = '';
    if(node.grammarType === 'identifier') 
      name = node.text + ", ";
    else 
      name = node.text.replace(/\s+/g, '').slice(0, 10) + ", " + 
                                       node.grammarType + ", ";
    if(!dumping) {
      firstDepth = depth;
      dumping    = true;
    }
    if(dumping && !done) {
      log('nomod', `${'    '.repeat(depth-firstDepth)}${node.type} `+
                   `(${node.startIndex},${node.endIndex}) ${name}`);
      if(lineCount++ > 1000) done = true;
    }
  });
}

export function getLangByFsPath(fsPath: string): string | null {
  const ext = path.extname(fsPath);
  for (const [lang, {suffixes}] of Object.entries(langs) as any) {
    if(suffixes.has(ext)) return lang;
  }
  log('infoerr', `Function Explorer: Language for ${ext} not supported.`);
  return null;
}

function idNodeName(node: SyntaxNode): string {
  const context  = node.text.slice(0, CONTEXT_LENGTH).replace(/\s+/g, '');
  if(node.grammarType === 'identifier') 
    return node.text + "\x00id\x00" + context + "\x00";
  else {
    const nameNode = node.childForFieldName('name');
    const name     = nameNode ? nameNode.text + "\x00" : '';
    return name + node.grammarType + "\x00" + context + "\x00";
  }
}

function getParentFuncId(node: SyntaxNode): string {
  let parentFuncId = '';
  let parent       = node.parent;
  while (parent) {
    parentFuncId += idNodeName(parent);
    parent = parent.parent;
  }
  return parentFuncId;
}

let lastParseErrFsPath = '';

export async function parseCode(lang: string, code: string, fsPath: string, 
                                doc: vscode.TextDocument, marks: String[] = [],
                                retrying = false, parseIdIdx: number | null = null): 
                                               Promise<NodeData[] | null> {
  start('parseCode', true);
  const language = await getLangFromWasm(lang);
  if (!language) return [];
  const {sExpr} = langs[lang];

  const marksSet = new Set();
  for (const mark of marks) marksSet.add(mark.split('\x00')[0]);

  let typeCounts: Map<string, number> = new Map();

  function collectParseStats(nodeData: NodeData) {
    typeCounts.set(nodeData.type, 
                  (typeCounts.get(nodeData.type) ?? 0) + 1);
  }

  function capToNodeData(
           nameCapture: QueryCapture, capture: QueryCapture): NodeData {
    const nameNode  = nameCapture.node;
    const startName = nameNode.startIndex;
    const endName   = nameNode.endIndex;
    const name      = nameNode.text;
    const type      = capture.name;
    const node      = capture.node;
    const start     = node.startIndex;
    const end       = node.endIndex;
    let funcId      = idNodeName(node) + getParentFuncId(node);
    funcId += fsPath;
    const nodeData: NodeData = { name, funcId, 
                                 start, startName, endName, end, type, lang};
    if(PARSE_DEBUG_STATS) collectParseStats(nodeData);
    return nodeData;
  }
  
  // start('parseCode', true);
  const parser = new Parser();
  parser.setLanguage(language);
  let tree: Tree | null;
  try {
    start('parser.parse', true);
    tree = parser.parse(code) as Tree | null;
    end('parser.parse', false);
    if(!tree) {
      log('err', 'parser.parse returned null tree for', path.basename(fsPath));
      return [];
    }
  } 
  catch (e) {
    if(retrying) {
      log('err', 'parser.parse failed again, giving up:', (e as any).message);
      return [];
    }
    const middle = utils.findMiddleOfText(code);
    if(lastParseErrFsPath !== fsPath)
      log('err', 'parse exception, retrying in two halves split at', middle,
                                 (e as any).message, path.basename(fsPath));
    lastParseErrFsPath = fsPath;
    const firstHalf = code.slice(0, middle);
    const res1 = await parseCode(lang, firstHalf, fsPath, doc, marks, true);
    if(!res1) return [];
    const secondHalf = code.slice(middle);
    const res2 = await parseCode(lang, secondHalf, fsPath, doc, marks, true);
    if (!res2) return [];
    for (const node of res2) {
      node.start += middle;
      node.end   += middle;
    }
    return res1.concat(res2);
  }
  if(PARSE_DUMP_NAME !== '' || PARSE_DUMP_TYPE !== '')   
    parseDebug(tree.rootNode);
  const nodes: NodeData[] = [];
  try {
    const query   = new Query(language as any, sExpr);
    const matches = query.matches(tree.rootNode as any);
    for (const match of matches) {
      let nameCapture: QueryCapture | null = null;
      let funcCapture: QueryCapture | null = null;
      let idCapture:   QueryCapture | null = null;
      for (const capture of match.captures) {
        switch(capture.name) {
          case 'name': nameCapture = capture; break;
          case 'func': funcCapture = capture; break;
          case 'id':     idCapture = capture; break;
        }
      }
      if (!nameCapture || !(funcCapture || idCapture) ||
            (idCapture && !marksSet.has(nameCapture.node.text))) continue;
      const funcIdCapture: QueryCapture = 
            funcCapture as QueryCapture ?? idCapture as QueryCapture;
      nodes.push(capToNodeData(nameCapture, funcIdCapture));
    }
  } catch (e) {
    log('err', 'S-expression query failed', (e as any).message);
    return [];
  }
  nodes.sort((a, b) => a.start - b.start);

  if(PARSE_DEBUG_STATS) {
    const lineCount = doc.positionAt(code.length).line;
    const nodeCount = nodes.length;
    log('nomod', `\n${path.basename(fsPath)}: ` +
        `parsed ${nodeCount} nodes in ${lineCount} lines\n` +
        [...typeCounts.entries()].map(([t,c]) => `${t}: ${c}`)
                                 .join('\n'), '\n');
  }
  end('parseCode', false);
  return nodes;
}
