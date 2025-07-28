import * as vscode                         from 'vscode';
import path                                from 'path';
import {langs}                             from './languages';
import { Tree, QueryCapture, 
         Parser, Language, Query }         from 'web-tree-sitter';
import * as utils                          from './utils';
import { mrks } from './dbs';
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
    if(!dumping) {
      firstDepth = depth;
      dumping    = true;
    }
    if(dumping && !done) {
      log('nomod', `${'    '.repeat(depth-firstDepth)}${node.type} `+
                   `(${node.startIndex},${
                       node.endIndex}) ${idNodeName(node)}`);
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
  if(!node.isNamed) return '';
  let name = '';
  let grammarType = node.type;
  if(grammarType in [ "identifier", "dotted_name", "lifetime", "metavariable",
                      "property_identifier", "shorthand_property_identifier",
                      "variable_name"]) {
    name = node.text;
  }
  else {
    const nameNode = node.childForFieldName('name');
    name = nameNode ? nameNode.text : '';
  }
  return name + "\x01" + grammarType + "\x00";
}

function getParentFuncId(node: SyntaxNode): string {
  let parentFuncId = '';
  let parent = node.parent;
  while (parent) {
    parentFuncId += idNodeName(parent);
    parent = parent.parent;
  }
  let context = node.text.slice(0, CONTEXT_LENGTH) + "\x00";
  return parentFuncId + context;
}

let typeCounts: Map<string, number> = new Map();

function collectParseStats(nodeData: NodeData) {
  typeCounts.set(nodeData.type, 
                (typeCounts.get(nodeData.type) ?? 0) + 1);
}

function capToNodeData(lang: string, fsPath: string,
          type, node, name, startIndex, endIndex): NodeData {
  let funcId = idNodeName(node) + getParentFuncId(node);
  funcId += fsPath;
  const nodeData: NodeData = { 
    lang, type, name, funcId, startIndex, endIndex};
  if(PARSE_DEBUG_STATS) collectParseStats(nodeData);
  return nodeData;
}

let lastParseErrFsPath = '';

export async function parseCode(code: string, fsPath: string, 
                                doc: vscode.TextDocument, 
                                retrying = false, 
                                parseIdx: number | null = null): 
                                               Promise<NodeData[]> {
  start('parseCode', true);
  const lang  = getLangByFsPath(fsPath);
  if(!lang) return [];
  const language = await getLangFromWasm(lang);
  if (!language) return [];
  const {sExpr}      = langs[lang];
  const haveParseIdx = parseIdx !== null;
  let keepNames = mrks.namesByFsPath(fsPath);
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
    const res1 = await parseCode(firstHalf,  fsPath, doc, true, parseIdx);
    if(!res1) return [];
    const secondHalf = code.slice(middle);
    const res2 = await parseCode(secondHalf, fsPath, doc, true, parseIdx);
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
  nodesLoop:
  try {
    let bestCapture: QueryCapture | null = null;
    let lastType     = '';
    let lastName     = '';
    let lastStartIdx = -1;
    let lastEndIdx   = -1;
    const query      = new Query(language as any, sExpr);
    const matches    = query.matches(tree.rootNode as any);
    for (const match of matches) {
      const capture  = match.captures[0];
      const type     = capture.name;
      const name     = capture.node.text;
      const startIdx = capture.node.startIndex;
      const endIdx   = capture.node.endIndex;
      if(name     === lastName     && 
         startIdx === lastStartIdx && 
         endIdx   === lastEndIdx) {
        if(typePriorty(type) > typePriorty(lastType))
          bestCapture = capture;
        continue;
      }
      if (bestCapture) 
        nodes.push(capToNodeData(lang, fsPath, bestCapture));
      bestCapture = capture;
      lastType     = type;
      lastName     = name;
      lastStartIdx = startIdx;
      lastEndIdx   = endIdx;
    }
    if (bestCapture) {
      nodes.push(capToNodeData(lang, fsPath, bestCapture));


      if(!haveParseIdx) {
        const name = nameCapture.node.text + '\x01' + 
                     nameCapture.node.type;
        if (!otherCapture && !keepNames.has(name)) continue;
        nodes.push(capToNodeData(lang, fsPath, nameCapture, otherCapture));
      }
      else {
        if(lastNameCapture && (nameCapture.node.startIndex ?? 0) > parseIdx) {
          nodes.push(capToNodeData(lang, fsPath, lastNameCapture!, 
                                                 lastOtherCapture!));
          nodes.push(capToNodeData(lang, fsPath, nameCapture, otherCapture));
          break nodesLoop;
        }
        lastNameCapture  = nameCapture;
        lastOtherCapture = otherCapture;
      }
    }
  } catch (e) {
    log('err', 'S-expression query failed', (e as any).message);
    return [];
  }
  nodes.sort((a, b) => a.start - b.start);

  if(PARSE_DEBUG_STATS) {
    const lineCount = doc.positionAt(code.length).line;
    const nodeCount = nodes.length;
    log(`${path.basename(fsPath)}, parseIdx: ${parseIdx} ` +
        `parsed ${nodeCount} nodes in ${lineCount} lines\n` +
        [...typeCounts.entries()].map(([t,c]) => `${t}: ${c}`)
                                 .join('\n'));
  }
  end('parseCode', false);
  return nodes;
}
