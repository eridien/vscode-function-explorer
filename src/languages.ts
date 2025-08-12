
type LangConfig = {
  sExpr:         string;
  symbolsByType: Map<string, string>;
  suffixes:      Set<string>;
};

export type Langs = {
  [lang: string]: LangConfig;
};

export const langs: Langs = {

///////////////////////////// typescript ///////////////////////////
  typescript: {
    sExpr: `[
      (function_declaration
        (identifier) @function_declaration
      )
      (variable_declarator
        (identifier)    @arrow_function
        (arrow_function)
      )
      (variable_declarator
        (identifier)    @call_expression
        (call_expression)
      )
     (variable_declarator
        (identifier)    @function_expression
        (function_expression)
      )
      (assignment_expression
        (identifier)    @arrow_function
        (arrow_function)
      )
      (method_definition
          name: (property_identifier) @method_definition
      )
      (class
        [
          (type_identifier) @class
          (identifier)      @class
        ]
      )
      (class_declaration
        [
          (type_identifier) @class_declaration
          (identifier)      @class_declaration
        ]
      )
      (assignment_expression
        (identifier) @assignment_expression
      )
      (property_identifier) @property_identifier
      (identifier) @identifier
    ] @body`,

    symbolsByType: new Map<string, string>([
      ['identifier',            '?'],
      ['property_identifier',   '?'],
      ['assignment_expression', '='],
      ['call_expression',       '('],
      ['class',                 '©'],
      ['class_declaration',     '©'],
      ['function_expression',   'ƒ'],
      ['method_definition',     'ƒ'],
      ['arrow_function',        'ƒ'],
      ['function_declaration',  'ƒ'],
    ]),

    suffixes: new Set(['.js', '.ts', '.tsx', '.jsx'])
  },

///////////////////////////// python ///////////////////////////
  python: {
    sExpr: `[
      (function_definition
        name: (identifier) @function_definition
       )
      (identifier) @identifier      
    ] @body`,

    symbolsByType: new Map<string, string>([
      ['identifier',           '?'],
      ['function_definition',  'ƒ'],
    ]),

    suffixes: new Set(['.py'])
  },

///////////////////////////// cpp ///////////////////////////
  cpp: {
    sExpr: `[
      (function_definition
        (function_declarator
           (identifier) @function_definition)
       )

      (namespace_definition
         (namespace_identifier) @namespace
       )

      (function_declarator
         (qualified_identifier) @function_declarator
       )

      (call_expression
         (identifier) @call_expression
       )

      (identifier) @identifier      
    ] @body`,

    symbolsByType: new Map<string, string>([
      ['identifier',           '?'],
      ['namespace',            '©'],
      ['call_expression',      '('],
      ['function_declarator',  'ƒ'],
      ['function_definition',  'ƒ'],
    ]),

    suffixes: new Set(['.c','.cpp'])
  },

///////////////////////////// java ///////////////////////////
  java: {
    sExpr: `[
      (method_declaration
           (identifier) @method_declaration
       )
      (identifier) @identifier      
    ] @body`,

    symbolsByType: new Map<string, string>([
      ['identifier',         '?'],
      ['method_declaration', 'ƒ'],
    ]),

    suffixes:    new Set(['.java'])
  },

///////////////////////////// c-sharp ///////////////////////////
  "c-sharp": {
    sExpr: `[ 
      [
        (method_declaration
          name: (identifier) @method_declaration
        )
        (local_function_statement
          name: (identifier) @local_function_statement
        )
      ]
      (identifier) @identifier      
    ] @body`,

    symbolsByType: new Map<string, string>([
      ['identifier',               '?'],
      ['method_declaration',       'ƒ'],
      ['local_function_statement', 'ƒ'],
    ]),

    suffixes:    new Set(['.cs'])
  },

///////////////////////////// go ///////////////////////////
  go: {
    sExpr: `[
      [ (function_declaration
          name: (identifier) @function_declaration)
        (method_declaration
          name: (field_identifier) @method_declaration)
      ]
      (identifier) @identifier      
    ] @body`,

    symbolsByType: new Map<string, string>([
      ['identifier',           '?'],
      ['method_declaration',   'ƒ'],
      ['function_declaration', 'ƒ'],
    ]),

    suffixes: new Set(['.go'])
  },

///////////////////////////// rust ///////////////////////////
  rust: {
    sExpr: `[
      (function_item
        (identifier) @function_item
      )
       (macro_invocation
         (identifier) @macro_invocation
      )
     (identifier) @identifier
    ] @body`,

    symbolsByType: new Map<string, string>([
      ['identifier',       '?'],
      ['macro_invocation', 'ƒ'],
      ['function_item',    'ƒ'],
    ]),

    suffixes: new Set(['.rs'])
  },
};

export const extensionsSupported = new Set<string>();
for (const [lang, {suffixes}] of Object.entries(langs) as any) {
  for (const suffix of suffixes) {
    extensionsSupported.add(suffix);
  }
}
