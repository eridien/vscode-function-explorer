const Parser = require('tree-sitter');
const path   = require('path');

// Load the compiled grammar
const JavaScript = require(
  path.join(__dirname, 'grammars', 'javascript', 'build', 'Release', 'tree_sitter_javascript_binding.node')
);

const parser = new Parser();
parser.setLanguage(JavaScript);

const sourceCode = 'function greet() { return "hi"; }';
const tree = parser.parse(sourceCode);

console.log(tree.rootNode.toString());
