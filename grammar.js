/**
 * @file Raku grammar for tree-sitter
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Precedence levels, loosest first, following the Raku operator table.
const PREC = {
  SEQUENCER: 1, // ==> <==
  LOOSE_OR: 2, // or xor orelse
  LOOSE_AND: 3, // and andthen notandthen
  LISTOP: 4, // say 1, 2 / .method: args
  LIST_INFIX: 5, // Z X ... minmax
  LIST_ASSIGN: 6, // @a = 1, 2, 3
  COMMA: 7,
  LOOSE_UNARY: 8, // not so
  ITEM_ASSIGN: 9, // =>
  CONDITIONAL: 10, // ?? !!  ff fff
  TIGHT_OR: 11, // || ^^ // min max
  TIGHT_AND: 12, // &&
  CHAINING: 13, // == eq < ~~ ...
  STRUCTURAL: 14, // .. cmp <=> but does
  JUNCTIVE_OR: 15, // | ^
  JUNCTIVE_AND: 16, // &
  CONCAT: 17, // ~
  REPLICATION: 18, // x xx
  ADDITIVE: 19, // + - +| ~|
  MULTIPLICATIVE: 20, // * / % div mod
  SYMBOLIC_UNARY: 21, // ! - + ~ ? ^ |
  EXPONENT: 22, // **
  AUTOINCREMENT: 23, // ++ --
  POSTFIX: 24, // .method [ ] { } ( )
};

const IDENT = /[\p{L}_][\p{L}\p{N}_]*(?:[-'][\p{L}_][\p{L}\p{N}_]*)*/;
const NAME_SRC = IDENT.source;

const PHASERS = [
  'BEGIN', 'CHECK', 'INIT', 'END', 'ENTER', 'LEAVE', 'KEEP', 'UNDO', 'FIRST',
  'NEXT', 'LAST', 'PRE', 'POST', 'CATCH', 'CONTROL', 'QUIT', 'CLOSE', 'DOC',
];

const STATEMENT_PREFIXES = [
  'do', 'try', 'gather', 'start', 'lazy', 'eager', 'hyper', 'race', 'quietly',
  'sink', 'once', 'react', 'supply',
];

const ROUTINE_KEYWORDS = ['sub', 'method', 'submethod', 'macro'];
const PACKAGE_KEYWORDS = ['class', 'role', 'grammar', 'module', 'package', 'knowhow', 'native', 'slang'];
const SCOPE_KEYWORDS = ['my', 'our', 'has', 'HAS', 'state', 'anon', 'augment', 'supersede'];
const TRAIT_KEYWORDS = ['is', 'does', 'handles', 'returns', 'of', 'hides', 'trusts', 'will', 'also'];

const BINARY_LEVELS = [
  ['left', 'SEQUENCER', '_op_sequencer'],
  ['left', 'LOOSE_OR', '_op_loose_or'],
  ['left', 'LOOSE_AND', '_op_loose_and'],
  ['left', 'LIST_INFIX', '_op_list_infix'],
  ['right', 'CONDITIONAL', '_op_conditional'],
  ['left', 'TIGHT_OR', '_op_tight_or'],
  ['left', 'TIGHT_AND', '_op_tight_and'],
  ['left', 'CHAINING', '_op_chaining'],
  ['left', 'STRUCTURAL', '_op_structural'],
  ['left', 'JUNCTIVE_OR', '_op_junctive_or'],
  ['left', 'JUNCTIVE_AND', '_op_junctive_and'],
  ['left', 'CONCAT', '_op_concat'],
  ['left', 'REPLICATION', '_op_replication'],
  ['left', 'ADDITIVE', '_op_additive'],
  ['left', 'MULTIPLICATIVE', '_op_multiplicative'],
  ['right', 'EXPONENT', '_op_exponent'],
];

// Symbolic operators outrank the immediate postfix tokens (`<`, `!`) so that
// `$a<=$b` and `$a!=$b` lex as single operators.
const sym = (/** @type {any} */ op) =>
  typeof op === 'string' && /^[<!]./.test(op) ? token(prec(2, op)) : op;

module.exports = grammar({
  name: 'raku',

  word: $ => $.identifier,

  // Raku has almost no reserved words: `is`, `if`, `say` ... may all be
  // routine or method names. Keywords only win where they are valid.
  reserved: {
    global: _ => [],
  },

  externals: $ => [
    $.comment,
    $.pod,
    $.heredoc_body,
    $._heredoc_start,
    $._string_start, // "
    $._qq_string_start, // qq<delim>
    $.string_content,
    $.escape_sequence,
    $._string_end,
    $._interpolation_postfix, // zero-width: a postfix follows an interpolated var
    $._quote_body, // non-interpolating delimited body: q{...}, Q[...], qw<...>
    $._regex_slash, // /.../ in term position
    $._regex_body, // delimited regex body after rx / m
    $._regex_block, // { ... } body of regex/token/rule
    $._subst_body, // complete s/// or tr/// body
    $._subst_pattern, // bracketed s{...} awaiting `= replacement`
    $._slash, // infix /
    $._block_close, // `}` closing a block; remembered by the scanner
    $._implicit_semicolon, // a block-closing `}` at end of line ends the statement
    $._error_sentinel,
  ],

  extras: $ => [/\s/, $.comment, $.pod, $.heredoc_body, /\\\r?\n/],

  supertypes: $ => [$._expression, $._statement, $._literal],

  inline: $ => [$._name],

  conflicts: $ => [
    [$._primary, $.listop_call],
  ],

  rules: {
    source_file: $ => optional($._statements),

    // A list of statements. Statements ending in a block (`if`, `sub`,
    // `class`, bare blocks, ...) need no semicolon; the last statement of a
    // block or file may also omit it.
    _statements: $ => choice(
      seq(
        repeat1(choice($._terminated_statement, ';')),
        optional($._final_statement),
      ),
      $._final_statement,
    ),

    _terminated_statement: $ => choice(
      seq($._statement, choice(';', $._implicit_semicolon)),
      $._block_statement,
    ),

    _final_statement: $ => $._statement,

    _statement: $ => choice(
      $.expression_statement,
      $.use_statement,
      $.constant_declaration,
      $.enum_declaration,
      $.subset_declaration,
      $.labeled_statement,
      $.unit_declaration,
      $.statement_modifier,
    ),

    _block_statement: $ => prec(1, choice(
      $.if_statement,
      $.unless_statement,
      $.with_statement,
      $.without_statement,
      $.for_statement,
      $.while_statement,
      $.loop_statement,
      $.repeat_statement,
      $.given_statement,
      $.when_statement,
      $.default_statement,
      $.whenever_statement,
      $.phaser,
      alias($._block_ending_expression, $.expression_statement),
    )),

    _block_ending_expression: $ => prec(1, choice(
      $.block,
      $.routine_declaration,
      $.package_declaration,
      $.regex_declaration,
      $.statement_prefix,
    )),

    expression_statement: $ => $._expressions,

    statement_modifier: $ => prec.left(seq(
      field('body', choice($._expressions, $.statement_modifier)),
      field('modifier', choice('if', 'unless', 'with', 'without', 'for', 'while', 'until', 'given', 'when')),
      field('condition', $._expression),
    )),

    // ---------------------------------------------------------------------
    // Control flow

    if_statement: $ => seq(
      'if',
      field('condition', $._expression),
      field('consequence', $._control_block),
      repeat(field('alternative', choice($.elsif_clause, $.orwith_clause))),
      optional(field('alternative', $.else_clause)),
    ),

    elsif_clause: $ => seq(
      'elsif',
      field('condition', $._expression),
      field('consequence', $._control_block),
    ),

    else_clause: $ => seq('else', field('body', $._control_block)),

    unless_statement: $ => seq(
      'unless',
      field('condition', $._expression),
      field('consequence', $._control_block),
      optional(field('alternative', $.else_clause)),
    ),

    with_statement: $ => seq(
      'with',
      field('condition', $._expression),
      field('consequence', $._control_block),
      repeat(field('alternative', choice($.orwith_clause, $.elsif_clause))),
      optional(field('alternative', $.else_clause)),
    ),

    orwith_clause: $ => seq(
      'orwith',
      field('condition', $._expression),
      field('consequence', $._control_block),
    ),

    without_statement: $ => seq(
      'without',
      field('condition', $._expression),
      field('consequence', $._control_block),
      optional(field('alternative', $.else_clause)),
    ),

    for_statement: $ => seq(
      'for',
      field('iterable', $._expressions),
      field('body', $._control_block),
    ),

    while_statement: $ => seq(
      choice('while', 'until'),
      field('condition', $._expression),
      field('body', $._control_block),
    ),

    loop_statement: $ => seq(
      'loop',
      optional(seq(
        '(',
        field('initializer', optional($._expression)), ';',
        field('condition', optional($._expression)), ';',
        field('update', optional($._expression)),
        ')',
      )),
      field('body', $.block),
    ),

    repeat_statement: $ => choice(
      seq('repeat', field('body', $.block), choice('while', 'until'), field('condition', $._expression)),
      seq('repeat', choice('while', 'until'), field('condition', $._expression), field('body', $.block)),
    ),

    given_statement: $ => seq('given', field('topic', $._expression), field('body', $._control_block)),

    when_statement: $ => seq('when', field('condition', $._expression), field('body', $._control_block)),

    default_statement: $ => seq('default', field('body', $.block)),

    whenever_statement: $ => seq('whenever', field('supply', $._expression), field('body', $._control_block)),

    _control_block: $ => choice($.block, $.pointy_block),

    phaser: $ => prec(2, seq(field('name', choice(...PHASERS)), field('body', $.block))),

    _phaser_expression: $ => prec.right(seq(field('name', choice(...PHASERS)), field('body', $._expressions))),

    // FOO: for @list { next FOO }
    labeled_statement: $ => seq(field('label', $.label), choice($._statement, $._block_statement)),

    label: _ => token(seq(/[A-Z_][A-Z0-9_-]*/, ':')),

    use_statement: $ => seq(
      field('keyword', choice('use', 'no', 'need', 'require', 'import')),
      field('module', choice($.version, $._long_name, $.indirect_name, $.string, $.variable)),
      optional(field('arguments', $._expressions)),
    ),

    unit_declaration: $ => seq(
      'unit',
      choice(...PACKAGE_KEYWORDS),
      field('name', $._long_name),
      repeat($.trait),
    ),

    // ---------------------------------------------------------------------
    // Declarations

    // Declarations are split into hidden pieces so that their optional
    // parts don't multiply into thousands of productions.
    package_declaration: $ => seq(
      optional(field('scope', $.scope)),
      field('kind', choice(...PACKAGE_KEYWORDS)),
      optional(field('name', choice($._long_name, '::'))),
      $._package_rest,
    ),

    _package_rest: $ => seq(
      optional(seq(token.immediate('['), optional($.parameter_list), ']')),
      optional($._traits),
      field('body', $.block),
    ),

    routine_declaration: $ => seq(
      optional(field('scope', $.scope)),
      $._routine_kind,
      optional($._routine_name),
      $._routine_rest,
    ),

    _routine_kind: $ => choice(
      seq(optional(field('multiplicity', $.multiplicity)), field('kind', choice(...ROUTINE_KEYWORDS))),
      field('multiplicity', $.multiplicity),
    ),

    _routine_name: $ => seq(
      optional(choice('!', '^')),
      field('name', choice(
        $._long_name,
        $.operator_name,
        // `method is(...)`, `method of { }`: a trait keyword right after
        // the routine keyword is its name.
        alias(prec(1, choice(...TRAIT_KEYWORDS)), $.identifier),
      )),
    ),

    _routine_rest: $ => seq(
      optional(field('signature', $.signature)),
      optional($._traits),
      field('body', $.block),
    ),

    _traits: $ => repeat1($.trait),

    multiplicity: _ => choice('multi', 'proto', 'only'),

    regex_declaration: $ => seq(
      optional(field('scope', $.scope)),
      optional(field('multiplicity', $.multiplicity)),
      field('kind', choice('regex', 'token', 'rule')),
      field('name', $._long_name),
      $._regex_rest,
    ),

    _regex_rest: $ => seq(
      optional(field('signature', $.signature)),
      optional($._traits),
      field('body', alias($._regex_block, $.regex_body)),
    ),

    variable_declaration: $ => prec.right(seq(
      field('scope', $.scope),
      optional(field('type', $.type)),
      field('name', choice(
        $.variable,
        $.anonymous_variable,
        $.sigilless_variable,
        seq('(', commaSep($._declaration_target), optional(','), ')'),
      )),
      optional($._traits),
    )),

    _declaration_target: $ => seq(
      optional($.type),
      optional(choice('*', '**', '+')),
      choice($.variable, $.sigilless_variable, $.colon_variable, $.anonymous_variable),
    ),

    constant_declaration: $ => prec.right(seq(
      optional(field('scope', $.scope)),
      'constant',
      optional(field('type', $.type)),
      field('name', choice($.variable, $.identifier, $.sigilless_variable)),
      optional($._traits),
      optional(seq(choice('=', ':=', '::='), field('value', $._expressions))),
    )),

    enum_declaration: $ => seq(
      optional(field('scope', $.scope)),
      'enum',
      optional(field('name', $._name)),
      optional($._traits),
      field('values', choice($.quote_words, $.parenthesized_expression, $.quoted)),
    ),

    subset_declaration: $ => prec.right(seq(
      optional(field('scope', $.scope)),
      'subset',
      field('name', $._name),
      optional($._traits),
      optional(seq('where', field('constraint', $._expression))),
    )),

    scope: _ => choice(...SCOPE_KEYWORDS),

    trait: $ => prec.right(seq(
      field('keyword', choice(...TRAIT_KEYWORDS)),
      field('value', choice(
        seq($._name, repeat(choice(
          $.type_arguments,
          alias(token.immediate(/:[DU_]/), $.type_smiley),
          $.argument_list,
          alias($._colon_angles, $.quote_words),
        ))),
        $._literal,
      )),
    )),

    signature: $ => seq(
      '(',
      optional($.parameter_list),
      optional(seq('-->', field('return_type', choice($.type, $._literal)))),
      ')',
    ),

    parameter_list: $ => seq(
      $.parameter,
      repeat(seq(choice(',', ':', ';;'), $.parameter)),
      optional(choice(',', ':')),
    ),

    parameter: $ => prec(1, seq(
      choice(
        seq(field('type', $.type), optional($._parameter_name)),
        $._parameter_name,
        field('name', $._literal),
        $.signature,
      ),
      repeat(choice(
        '?',
        '!',
        field('subsignature', $.signature),
        $.trait,
        seq('where', field('constraint', $._expression)),
        seq('=', field('default', $._expression)),
      )),
    )),

    _parameter_name: $ => choice(
      seq(
        optional(field('prefix', choice('*', '**', '+'))),
        field('name', choice($.variable, $.anonymous_variable)),
      ),
      seq(field('prefix', '|'), optional(field('name', choice($.variable, $.identifier)))),
      field('name', choice($.sigilless_variable, $.named_parameter, $.colon_variable)),
    ),

    named_parameter: $ => seq(
      alias($.colon_name, $.name),
      token.immediate('('),
      $.parameter,
      ')',
    ),

    type: $ => prec.right(seq($._name, repeat($._type_suffix))),

    _type_suffix: $ => choice(
      $.type_arguments,
      alias(token.immediate(/:[DU_]/), $.type_smiley),
      // coercion types: Int(), IO(Cool)
      seq(token.immediate('('), optional(field('coerce_from', $.type)), ')'),
    ),

    // Foo::Bar:ver<1.0>:auth<zef:me>
    _long_name: $ => seq($.identifier, repeat($.name_adverb)),

    name_adverb: $ => seq(
      field('key', alias(token.immediate(seq(':', IDENT)), $.name)),
      optional(field('value', choice(alias($._colon_angles, $.quote_words), $.argument_list))),
    ),

    type_arguments: $ => seq(token.immediate('['), optional($._expressions), ']'),

    // ---------------------------------------------------------------------
    // Expressions

    _expression: $ => choice(
      $._primary,
      $.unary_expression,
      $.binary_expression,
      $.ternary_expression,
      $.assignment,
      $.mutating_method_call,
      $.listop_call,
      $.method_listop_call,
      $.pointy_block,
    ),

    _primary: $ => choice(
      $._literal,
      $.variable,
      $.anonymous_variable,
      prec(PREC.LISTOP, $.identifier),
      $.operator_name,
      $.self,
      $.whatever,
      $.yada,
      $.parenthesized_expression,
      $.array_constructor,
      $.block,
      $.contextualizer,
      $.call_expression,
      $.method_call,
      $.subscript,
      $.postfix_expression,
      $.variable_declaration,
      $.routine_declaration,
      $.package_declaration,
      $.statement_prefix,
      $.reduce_expression,
      $.indirect_name,
      $.signature_literal,
      $.colon_call,
      alias($._phaser_expression, $.phaser),
      $.colonpair,
      $.topic_method_call,
      $.topic_subscript,
    ),

    _literal: $ => choice(
      $.integer,
      $.decimal,
      $.rational,
      $.complex,
      $.version,
      $.string,
      $.interpolated_string,
      $.quote_words,
      $.quoted,
      $.heredoc,
      $.regex,
      $.substitution,
    ),

    self: _ => 'self',

    whatever: _ => choice('*', '**'),

    yada: $ => prec.right(seq(choice('...', '!!!', '???', '…'), optional($._expression))),

    anonymous_variable: _ => choice('$', '@', '%'),

    // A comma list or single expression; binds tighter than the loose
    // logical operators, so `say 1 and say 2` splits at `and`.
    _expressions: $ => prec(PREC.LISTOP, choice($._expression, $.list_expression)),

    parenthesized_expression: $ => seq('(', optional(choice($._expressions, ',', $.statement_modifier)), ')'),

    // :(Int $x, Str $y --> Bool)
    signature_literal: $ => seq(
      ':(',
      optional($.parameter_list),
      optional(seq('-->', field('return_type', choice($.type, $._literal)))),
      ')',
    ),

    // say $fh: 'text'   $.method: args   (indirect object / attribute method)
    colon_call: $ => prec.right(PREC.LISTOP, seq(
      field('invocant', $.variable),
      token.immediate(':'),
      field('arguments', $._expressions),
    )),

    // ::('Name')
    indirect_name: $ => seq('::(', $._expressions, ')'),

    array_constructor: $ => seq('[', optional($._expressions), ']'),

    contextualizer: $ => seq(choice('$(', '@(', '%(', '&('), optional($._expressions), ')'),

    reduce_expression: $ => prec.right(PREC.LISTOP, seq(
      field('operator', $.reduce_operator),
      optional(field('argument', $._expressions)),
    )),

    reduce_operator: _ => token(seq(
      '[',
      optional('\\'),
      optional(/[RZX]/),
      choice(
        '+', '-', '*', '/', '~', '**', '%', 'max', 'min', 'minmax', '&&', '||',
        '//', '^^', '&', '|', '^', '==', '!=', '<', '<=', '>', '>=', 'eq', 'ne',
        'lt', 'le', 'gt', 'ge', 'eqv', '===', '~~', ',', 'Z', 'X', 'xx', 'x',
        'and', 'or', 'cmp', 'leg', 'lcm', 'gcd', '+&', '+|', '+^', '~&', '~|', '?&', '?|',
      ),
      ']',
    )),

    statement_prefix: $ => prec.right(seq(
      field('prefix', choice(...STATEMENT_PREFIXES)),
      field('body', choice(
        prec(1, $.block),
        $._expressions,
        $.if_statement,
        $.unless_statement,
        $.with_statement,
        $.without_statement,
        $.for_statement,
        $.while_statement,
        $.given_statement,
        $.loop_statement,
      )),
    )),

    block: $ => seq('{', optional($._statements), alias($._block_close, '}')),

    pointy_block: $ => seq(
      choice('->', token(prec(2, '<->'))),
      optional(field('parameters', $.parameter_list)),
      optional(seq('-->', field('return_type', $.type))),
      field('body', $.block),
    ),

    // foo(1, 2)
    call_expression: $ => prec(PREC.POSTFIX, seq(
      field('function', $._primary),
      field('arguments', $.argument_list),
    )),

    // say 1, 2;  foo $x;
    listop_call: $ => prec(PREC.LISTOP, seq(
      field('function', $.identifier),
      field('arguments', $._listop_arguments),
    )),

    _listop_arguments: $ => prec.dynamic(-1, $._expressions),

    argument_list: $ => seq(
      choice(token.immediate('('), '\\('),
      optional(choice($._expressions, ',')),
      ')',
    ),

    method_call: $ => prec(PREC.POSTFIX, seq(
      field('invocant', $._primary),
      $._method_tail,
    )),

    // $png.write: 'file.png'
    method_listop_call: $ => prec.right(PREC.LISTOP, seq(
      field('invocant', $._primary),
      choice(
        seq('.', optional(field('modifier', $._method_modifier))),
        field('modifier', alias(token.immediate(prec(1, '!')), '!')),
      ),
      field('method', $._method_name),
      token.immediate(':'),
      field('arguments', $._expressions),
    )),

    topic_method_call: $ => choice(
      prec.right(PREC.POSTFIX, seq(
        '.',
        optional(field('modifier', $._method_modifier)),
        field('method', $._method_name),
        optional(field('arguments', $.argument_list)),
      )),
      prec.right(PREC.LISTOP, seq(
        '.',
        optional(field('modifier', $._method_modifier)),
        field('method', $._method_name),
        token.immediate(':'),
        field('arguments', $._expressions),
      )),
      prec(PREC.POSTFIX, seq('.', field('arguments', $.argument_list))),
    ),

    topic_subscript: $ => prec(PREC.POSTFIX, seq(
      '.',
      field('index', choice($._index_brackets, $._key_braces, $._key_angles)),
    )),

    _method_tail: $ => prec.right(choice(
      seq(
        choice(
          seq('.', optional(field('modifier', $._method_modifier))),
          field('modifier', alias(token.immediate(prec(1, '!')), '!')),
          field('modifier', alias(token.immediate(choice('>>.', '».')), '>>.')),
        ),
        field('method', $._method_name),
        optional(field('arguments', $.argument_list)),
      ),
      seq(
        '.',
        field('method', choice($.variable, $.parenthesized_expression)),
        optional(field('arguments', $.argument_list)),
      ),
      seq('.', field('arguments', $.argument_list)),
      seq('.', field('index', choice($._index_brackets, $._key_braces, $._key_angles))),
    )),

    _method_modifier: _ => alias(token.immediate(choice('^', '?', '+', '*', '=', '&')), 'meta'),

    _method_name: $ => choice(
      $.identifier,
      alias($.string, $.identifier),
      alias($.interpolated_string, $.identifier),
    ),

    subscript: $ => prec(PREC.POSTFIX, seq(
      field('container', $._primary),
      field('index', choice($._index_brackets, $._key_braces, $._key_angles)),
    )),

    _index_brackets: $ => prec.right(seq(
      alias(token.immediate(prec(1, '[')), '['),
      optional(seq($._expressions, repeat(seq(';', optional($._expressions))))),
      ']',
      repeat(alias($.colon_name, $.adverb)),
    )),

    _key_braces: $ => prec.right(seq(
      alias(token.immediate(prec(1, '{')), '{'),
      optional($._expressions),
      '}',
      repeat(alias($.colon_name, $.adverb)),
    )),

    _key_angles: $ => prec.right(seq(
      alias(token.immediate(prec(1, '<')), '<'),
      repeat(alias($._word, $.word)),
      '>',
      repeat(alias($.colon_name, $.adverb)),
    )),

    postfix_expression: $ => prec(PREC.AUTOINCREMENT, seq(
      field('argument', $._primary),
      field('operator', alias(token.immediate(choice('++', '--')), $.operator)),
    )),

    unary_expression: $ => choice(
      prec.right(PREC.AUTOINCREMENT, seq(field('operator', choice('++', '--')), field('argument', $._expression))),
      prec.right(PREC.SYMBOLIC_UNARY, seq(
        field('operator', choice('!', '-', '+', '~', '?', '^', '|', '||', '+^', '~^', '?^', '\\', '−', '⚛', '++⚛', '--⚛')),
        field('argument', $._expression),
      )),
      prec.right(PREC.LOOSE_UNARY, seq(field('operator', choice('not', 'so')), field('argument', $._expression))),
      prec.right(PREC.TIGHT_OR, seq(field('operator', choice('temp', 'let')), field('argument', $._expression))),
    ),

    binary_expression: $ => choice(...BINARY_LEVELS.map(([assoc, level, name]) =>
      (assoc === 'right' ? prec.right : prec.left)(PREC[level], seq(
        field('left', $._expression),
        field('operator', $[name]),
        field('right', $._expression),
      )),
    )),

    // One hidden rule per precedence level keeps binary_expression to a
    // handful of productions instead of one per operator.
    _op_sequencer: $ => choice(...['==>', '<==', '==>>', '<<=='].map(op => sym(op))),

    _op_loose_or: $ => choice(...['or', 'xor', 'orelse'].map(op => sym(op))),

    _op_loose_and: $ => choice(...['and', 'andthen', 'notandthen'].map(op => sym(op))),

    _op_list_infix: $ => choice(...['Z', 'X', '...', '…', '...^', '^...', 'minmax', /[ZX][^\s\w(]+/].map(op => sym(op))),

    _op_conditional: $ => choice(...['ff', 'ff^', '^ff', '^ff^', 'fff', 'fff^', '^fff', '^fff^'].map(op => sym(op))),

    _op_tight_or: $ => choice(...['||', '^^', '//', 'min', 'max'].map(op => sym(op))),

    _op_tight_and: $ => choice(...['&&'].map(op => sym(op))),

    _op_chaining: $ => choice(...['==', '!=', '≠', '<', '<=', '≤', '>', '>=', '≥', 'eq', 'ne', 'lt', 'le', 'gt', 'ge',
          '~~', '!~~', '===', '!===', 'eqv', '!eqv', '=~=', '≅', '=:=', '!=:=', 'before', 'after',
          '(elem)', '∈', '∉', '(cont)', '∋', '∌', '(<)', '⊂', '(<=)', '⊆', '(>)', '⊃', '(>=)', '⊇',
          '%%',].map(op => sym(op))),

    _op_structural: $ => choice(...['..', '..^', '^..', '^..^', 'cmp', 'leg', '<=>', 'but', 'does', 'coll', 'unicmp',].map(op => sym(op))),

    _op_junctive_or: $ => choice(...['|', '^'].map(op => sym(op))),

    _op_junctive_and: $ => choice(...['&'].map(op => sym(op))),

    _op_concat: $ => choice(...['~', '∘', 'o'].map(op => sym(op))),

    _op_replication: $ => choice(...['x', 'xx'].map(op => sym(op))),

    _op_additive: $ => choice(...['+', '-', '−', '+|', '+^', '~|', '~^', '?|', '?^', '(|)', '∪', '(&)', '∩', '(-)', '∖', '(^)', '⊖'].map(op => sym(op))),

    _op_multiplicative: $ => choice(...['*', '×', alias($._slash, '/'), '÷', '%', 'div', 'mod', 'gcd', 'lcm', '+&', '+<', '+>', '~&', '~<', '~>', '?&', '(.)', '⊍'].map(op => sym(op))),

    _op_exponent: $ => choice(...['**'].map(op => sym(op))),

    ternary_expression: $ => prec.right(PREC.CONDITIONAL, seq(
      field('condition', $._expression),
      '??',
      field('consequence', $._expression),
      token(prec(2, '!!')),
      field('alternative', $._expression),
    )),

    // Assignment is parsed at list-assignment precedence so that
    // `my @a = 1, 2, 3` groups the whole list on the right.
    assignment: $ => choice(
      prec.right(PREC.LIST_ASSIGN, seq(
        field('left', $._expression),
        field('operator', choice('=', ':=', '::=', '⚛=', /(?:[-+*\/~%x]|\*\*|xx|\/\/|\|\||&&|min|max|div|mod|[+~?][|&^<>])=/)),
        field('right', $._expressions),
      )),
      prec.right(PREC.ITEM_ASSIGN, seq(
        field('left', $._expression),
        field('operator', choice('=>', '⇒')),
        field('right', $._expression),
      )),
    ),

    // $obj .= new(...)   $str .= trim
    mutating_method_call: $ => prec.right(PREC.LIST_ASSIGN, seq(
      field('invocant', $._expression),
      '.=',
      field('method', choice($.identifier, $.variable)),
      optional(choice(
        field('arguments', $.argument_list),
        seq(token.immediate(':'), field('arguments', $._expressions)),
      )),
    )),

    list_expression: $ => choice(
      prec.right(PREC.COMMA, seq(
        $._expression,
        choice(',', seq(repeat1(prec.right(PREC.COMMA, seq(',', $._expression))), optional(','))),
      )),
      // adjacent colonpairs need no commas: :a(1) :b(2)
      prec.right(PREC.COMMA, seq($.colonpair, repeat1($.colonpair))),
    ),

    // :name, :!name, :name(value), :name<words>, :name[list], :name{...}, :$var
    colonpair: $ => prec.right(choice(
      seq(
        field('key', alias($.colon_name, $.name)),
        optional(field('value', choice(
          $.argument_list,
          alias($._colon_angles, $.quote_words),
          alias($._colon_brackets, $.array_constructor),
          alias($._colon_braces, $.block),
        ))),
      ),
      field('key', $.colon_variable),
      seq(
        field('key', alias(token(/:\d+/), $.integer)),
        field('value', choice(
          $.argument_list,
          alias($._colon_brackets, $.array_constructor),
          alias($._colon_angles, $.quote_words),
          alias(token.immediate(IDENT), $.name),
        )),
      ),
    )),

    _colon_angles: $ => seq(token.immediate('<'), repeat(alias($._word, $.word)), '>'),
    _colon_brackets: $ => seq(token.immediate('['), optional($._expressions), ']'),
    _colon_braces: $ => seq(token.immediate('{'), optional($._statements), alias($._block_close, '}')),

    colon_name: _ => token(seq(':', optional('!'), IDENT)),

    colon_variable: _ => token(seq(':', /[$@%&][.!*^]?/, IDENT)),

    // ---------------------------------------------------------------------
    // Literals

    integer: _ => token(choice(
      /\d[\d_]*/,
      /0x[0-9a-fA-F_]+/,
      /0o[0-7_]+/,
      /0b[01_]+/,
      /0d[\d_]+/,
      /:\d+<[0-9a-zA-Z_.]+>/,
    )),

    decimal: _ => token(choice(
      /\d[\d_]*\.\d[\d_]*([eE][-+]?\d+)?/,
      /\d[\d_]*[eE][-+]?\d+/,
      'Inf', 'NaN', '∞',
    )),

    rational: _ => token(seq('<', /-?\d+/, '/', /\d+/, '>')),

    complex: _ => token(/\d[\d_]*(\.\d[\d_]*)?([eE][-+]?\d+)?i/),

    version: _ => token(prec(1, /v\d+(\.(\w+|\*))*\+?/)),

    // '...' and 「...」
    string: _ => token(choice(
      seq("'", repeat(choice(/[^'\\]+/, /\\./)), "'"),
      seq('‘', repeat(choice(/[^’\\]+/, /\\./)), '’'),
      seq('「', /[^」]*/, '」'),
    )),

    // "..." and qq{...}
    interpolated_string: $ => seq(
      choice(
        $._string_start,
        seq(alias('qq', $.quote_operator), repeat($.adverb), $._qq_string_start),
      ),
      repeat(choice(
        $.string_content,
        $.escape_sequence,
        $.interpolation,
      )),
      $._string_end,
    ),

    interpolation: $ => choice(
      $._interpolated_variable,
      alias($._interpolation_block, $.block),
    ),

    _interpolated_variable: $ => seq(
      choice($.variable, $.contextualizer),
      repeat(seq(
        $._interpolation_postfix,
        choice(
          alias($._interp_index, $.subscript),
          alias($._interp_method, $.method_call),
          alias($.argument_list, $.call_expression),
        ),
      )),
    ),

    _interp_index: $ => field('index', choice($._index_brackets, $._key_braces, $._key_angles)),

    _interp_method: $ => seq(
      '.',
      optional(field('modifier', $._method_modifier)),
      field('method', $._method_name),
      field('arguments', $.argument_list),
    ),

    _interpolation_block: $ => seq('{', optional($._statements), '}'),

    adverb: _ => token.immediate(seq(':', optional('!'), IDENT, optional(/\(\d*\)/))),

    // <a b c>  «a b»  <<a b>>
    quote_words: $ => choice(
      seq('<', repeat(alias($._word, $.word)), '>'),
      seq(choice('<<', '«'), repeat(alias($._word, $.word)), choice('>>', '»')),
    ),

    _word: _ => token(prec(-1, /[^\s<>«»]+/)),

    // q{...}  Q[...]  qw<...>  qx/.../
    quoted: $ => seq(
      field('operator', alias(choice('q', 'Q', 'qw', 'qqw', 'qqww', 'qx', 'qqx', 'Qw'), $.quote_operator)),
      repeat($.adverb),
      alias($._quote_body, $.string_content),
    ),

    // q:to/END/ ... END
    heredoc: $ => seq(
      field('operator', alias(choice('q', 'qq', 'Q'), $.quote_operator)),
      alias(token.immediate(prec(2, choice(':to', ':heredoc'))), $.adverb),
      repeat($.adverb),
      alias($._heredoc_start, $.heredoc_start),
    ),

    regex: $ => choice(
      alias($._regex_slash, $.regex_body),
      seq(
        field('operator', alias(choice('rx', 'm', 'ms'), $.quote_operator)),
        repeat($.adverb),
        alias($._regex_body, $.regex_body),
      ),
    ),

    substitution: $ => prec.right(seq(
      field('operator', alias(choice('s', 'S', 'ss', 'tr', 'TR', 'y'), $.quote_operator)),
      repeat($.adverb),
      choice(
        alias($._subst_body, $.regex_body),
        seq(
          alias($._subst_pattern, $.regex_body),
          '=',
          field('replacement', $._expression),
        ),
      ),
    )),

    // ---------------------------------------------------------------------
    // Names and variables

    _name: $ => $.identifier,

    identifier: _ => token(choice(
      seq(optional('::'), IDENT, repeat(seq('::', IDENT)), optional('::')),
      seq('::?', /[A-Z]+/),
    )),

    operator_name: _ => token(seq(
      choice('infix', 'prefix', 'postfix', 'circumfix', 'postcircumfix', 'term', 'trait_mod', 'category'),
      ':',
      choice(/<[^>]+>/, /«[^»]+»/, /<<[^>]+>>/),
    )),

    // $x  @list  %hash  &code  $.attr  $!private  $*DYNAMIC  $?COMPILE  $^placeholder
    variable: _ => token(choice(
      seq(/[$@%&]/, optional(/[.!*?^:=~]/), IDENT, repeat(seq('::', IDENT))),
      seq(/[$@%&]/, optional('::'), IDENT, repeat(seq('::', IDENT))),
      seq(/[$@%&]/, /[$@%&]/, optional(/[.!*?^]/), IDENT),
      /\$\d+/,
      /\$<[^>\s]+>/,
      /[$@%]\//,
      '$!',
      '$¢',
      /[@%]_/,
    )),

    sigilless_variable: _ => token(seq('\\', IDENT)),
  },
});

/**
 * @param {RuleOrLiteral} rule
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/**
 * @param {RuleOrLiteral} rule
 * @returns {ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}
