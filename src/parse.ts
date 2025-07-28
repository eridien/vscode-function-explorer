import * as vscode                         from 'vscode';
import path                                from 'path';
import {langs}                             from './languages';
import { Tree, QueryCapture, QueryMatch,
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
  if(["identifier", "dotted_name", "lifetime", "metavariable",
      "property_identifier", "shorthand_property_identifier",
      "variable_name"].includes(grammarType)) {
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
  return parentFuncId;
}

let typeCounts: Map<string, number> = new Map();

function collectParseStats(nodeData: NodeData) {
  typeCounts.set(nodeData.type, 
                (typeCounts.get(nodeData.type) ?? 0) + 1);
}

function capToNodeData(code: string, lang: string, fsPath: string,
                       bodyCapture: QueryCapture, 
                       nameCapture: QueryCapture): NodeData {
  const start     = bodyCapture.node.startIndex;
  const end       = bodyCapture.node.endIndex;
  const type      = nameCapture.name;
  const node      = nameCapture.node;
  const name      = node.text;
  const startName = node.startIndex;
  const endName   = node.endIndex;
  const context   = code.slice(start, start + CONTEXT_LENGTH);
  let funcId      = getParentFuncId(node) + context + '\x00' +fsPath;
  const nodeData  = {lang, name, type, funcId, start, startName, endName, end};
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
  const lang = getLangByFsPath(fsPath);
  if(lang === null) return [];
  const language = await getLangFromWasm(lang);
  if (!language) return [];
  const haveParseIdx  = parseIdx !== null;
  const {sExpr}       = langs[lang];
  const symbolsByType = langs[lang].symbolsByType;
  const typePriority  = new Map<string, number>();
  for(const [type, _] of symbolsByType)
    typePriority.set(type, typePriority.size);
  typePriority.set('identifier', -1);
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
  let query:   Query;
  let matches: QueryMatch[];
  try {
    query   = new Query(language as any, sExpr);
    matches = query.matches(tree.rootNode as any);
  } catch (e) {
    log('err', 'S-expression query failed', (e as any).message);
    return [];
  }
  const nodes: NodeData[] = [];
  let bestBodyCapture: QueryCapture | null = null;
  let bestNameCapture: QueryCapture | null = null;
  let bestName      = '';
  let bestType      = '';
  let lastStartName = -1;
  let lastName      = '';
  let lastType      = '';
  let firstMatch    = true;
  for(let matchIdx = 0; matchIdx < matches.length; matchIdx++) {
    const match = matches[matchIdx];
    if(match.captures.length !== 2) {
      log('err', `bad capture count ${match.captures.length} in ${lang}`);
      continue;
    }
    const bodyIdx     = match.captures[0].name === 'body' ? 0 : 1;
    const bodyCapture = match.captures[bodyIdx];
    const nameCapture = match.captures[1-bodyIdx];
    const startName   = nameCapture.node.startIndex;
    const type        = nameCapture.name;
    const name        = nameCapture.node.text;
    if(firstMatch) {
      bestBodyCapture = bodyCapture;
      bestNameCapture = nameCapture;
      bestName        = name;
      bestType        = type;
    }
    if(name === lastName && startName === lastStartName) {
      if((typePriority.get(type)     ?? 0) > 
         (typePriority.get(lastType) ?? 0)) {
        bestBodyCapture = bodyCapture;
        bestNameCapture = nameCapture;
        bestName        = name;
        bestType        = type;
      }
      firstMatch = false;
      continue;
    }
    firstMatch = true;
    function callCapToNodeData(): boolean {
      if(haveParseIdx) {
        if(startName > parseIdx) {
          nodes.push(capToNodeData(code, lang!, fsPath,
                                   bestBodyCapture!, bestNameCapture!));
          nodes.push(capToNodeData(code, lang!, fsPath,
                                   bodyCapture!, nameCapture!));
          return true;
        }
      }
      else {
        const nameId = bestName + '\x01' + bestType;
        if(bestType !== 'identifier' || keepNames.has(nameId))
          nodes.push(capToNodeData(code, lang!, fsPath, 
                                   bestBodyCapture!, bestNameCapture!));
      }
      return false;
    }
    if (bestBodyCapture && callCapToNodeData()) break;
    lastStartName   = startName;
    lastName        = name;
    lastType        = type;
    if(matchIdx == matches.length - 1) callCapToNodeData();
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
