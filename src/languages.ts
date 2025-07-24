
type LangConfig = {
  sExpr:       string;
  symbols:     Map<string, string>;
  funcTypes:   Set<string>;
  suffixes:    Set<string>;
};

export type Langs = {
  [lang: string]: LangConfig;
};

export const langs: Langs = {

///////////////////////////// typescript ///////////////////////////
  typescript: {
    sExpr: `
      [
        (function_declaration
            name: (identifier) @name
        ) @function_declaration

          ;; Identifier declaration
        [ (variable_declarator
            name: (identifier) @name
            value: [
              (arrow_function)
              (call_expression
                arguments: (arguments
                  (arrow_function)))
              (parenthesized_expression
                (arrow_function))
            ])
          ;; Identifier assignment
          (assignment_expression
            left: (identifier) @name
            right: [
              (arrow_function)
              (call_expression
                arguments: (arguments
                  (arrow_function)))
              (parenthesized_expression
                (arrow_function))
            ])
        ]
        @arrow_function

        (method_definition
            name: (property_identifier) @name
         ) @method_definition
         
      (((identifier) @name
       ) @identifier)        
     ]
    `,
    symbols: new Map<string, string>([
      ['function_declaration',  'ƒ'],
      ['arrow_function',        'ƒ'],
      ['method_definition',     'f'],
      ['identifier',            '▷'],
    ]),
    funcTypes: new Set(
             ["function_declaration", "method_definition", "arrow_function"]),
    suffixes: new Set(['.js', '.ts', '.tsx', '.jsx'])
  },

///////////////////////////// python ///////////////////////////
  python: {
    sExpr: `
      [
        (function_definition
          name: (identifier) @name
         ) @function_definition

        (((identifier) @name
        ) @identifier)        
      ]
    `,
    symbols: new Map([
      ['function_definition',   'ƒ'],
      ['identifier',            '▷'],
    ]),
    funcTypes: new Set(["function_definition"]),
    suffixes:  new Set(['.py'])
  },

///////////////////////////// cpp ///////////////////////////
  cpp: {
    sExpr: `
      [
        (function_definition
          declarator: (function_declarator
            declarator: (identifier) @name)
         ) @function_definition

        (((identifier) @name
        ) @identifier)        
      ]
    `,
    symbols: new Map([
      ['function_definition',   'ƒ'],
      ['identifier',            '▷'],
    ]),
    funcTypes:   new Set(["function_definition"]),
    suffixes:    new Set(['.c','.cpp'])
  },

///////////////////////////// java ///////////////////////////
  java: {
    sExpr: `[
      ((method_declaration
           (identifier) @name
       ) @method_declaration)

      (((identifier) @name
       ) @identifier)
    ]
    `,
    symbols: new Map([
      ['method_declaration',    'ƒ'],      
      ['identifier',            '▷'],      
    ]),
    funcTypes:   new Set(["method_declaration"]),
    suffixes:    new Set(['.java'])
  },

///////////////////////////// c-sharp ///////////////////////////
  "c-sharp": {
    sExpr: `
      [
        (method_declaration
           name: (identifier) @name
         ) @method_declaration

        (local_function_statement
           name: (identifier) @name
         ) @local_function_statement

          (((identifier) @name
          ) @identifier)
        ]
    `,
    symbols: new Map([
      ['method_declaration',          'ƒ'],
      ['local_function_statement',    'ƒ'],
      ['identifier',                  '▷'],
    ]),
    funcTypes:   new Set(["method_declaration", "local_function_statement"]),
    suffixes:    new Set(['.cs'])
  },

///////////////////////////// go ///////////////////////////
  go: {
    sExpr: `
      [
        (function_declaration
          name: (identifier) @name) @function
        
        (method_declaration
          name: (field_identifier) @name) @method
      
        (((identifier) @name
        ) @identifier)
      ]
    `,

    symbols: new Map([
      ['function',   'ƒ'],
      ['method',     'ƒ'],
      ['identifier', '▷'],
    ]),
    funcTypes:   new Set(["function", 'method']),
    suffixes:    new Set(['.go'])
  },

///////////////////////////// rust ///////////////////////////
  rust: {
    sExpr: `
      [
        (function_item
          name: (identifier) @name
        ) @function

        (((identifier) @name
        ) @identifier)                
      ]
    `,
    symbols: new Map([
      ['function',   'ƒ'],
      ['identifier',       '▷'],
    ]),
    funcTypes:   new Set(["function"]),
    suffixes:    new Set(['.rs'])
  },
};

/*

*/