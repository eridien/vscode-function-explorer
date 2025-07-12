import Parser from 'node-tree-sitter';
import fs from 'fs';
import { join } from 'path';

const parser = new Parser();
const C = Parser.Language.load(join('grammars', 'c', 'build', 'release', 'tree-sitter-c.node'));

parser.setLanguage(C);

const sourceCode = `
int main() {
  return 0;
}
`;

const tree = parser.parse(sourceCode);
console.log(tree.rootNode.toString());
