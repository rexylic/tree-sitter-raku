// External scanner for tree-sitter-raku.
//
// Handles the parts of Raku's lexical syntax that a context-free lexer cannot:
// comments (including embedded `#`( ... )` comments), Pod blocks, heredocs,
// arbitrarily-delimited quotes and regexes, and the contents of interpolating
// strings, which need a stack of open delimiters.

#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <wctype.h>

enum TokenType {
  COMMENT,
  POD,
  HEREDOC_BODY,
  HEREDOC_START,
  STRING_START,
  QQ_STRING_START,
  STRING_CONTENT,
  ESCAPE_SEQUENCE,
  STRING_END,
  INTERPOLATION_POSTFIX,
  QUOTE_BODY,
  REGEX_SLASH,
  REGEX_BODY,
  REGEX_BLOCK,
  SUBST_BODY,
  SUBST_PATTERN,
  SLASH,
  BLOCK_CLOSE,
  IMPLICIT_SEMICOLON,
  ERROR_SENTINEL,
};

#define MAX_STRINGS 16
#define MAX_HEREDOCS 4
#define MAX_TERMINATOR 32

typedef struct {
  int32_t close;
  int32_t open; // equal to close for non-bracketing delimiters
  uint16_t depth;
} StringFrame;

typedef struct {
  uint8_t length;
  int32_t chars[MAX_TERMINATOR];
} Heredoc;

typedef struct {
  // Column just past the most recent block-closing `}`, or -1. Used to
  // detect `}` followed by a newline, which terminates a statement.
  int16_t brace_column;
  uint8_t string_count;
  StringFrame strings[MAX_STRINGS];
  uint8_t heredoc_count;
  Heredoc heredocs[MAX_HEREDOCS];
} Scanner;

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }
static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static int32_t closing_bracket(int32_t c) {
  switch (c) {
    case '(': return ')';
    case '[': return ']';
    case '{': return '}';
    case '<': return '>';
    case 0x00AB: return 0x00BB; // « »
    case 0x201C: return 0x201D; // “ ”
    case 0x201E: return 0x201D; // „ ”
    case 0x2018: return 0x2019; // ‘ ’
    case 0x300C: return 0x300D; // 「 」
    case 0x27E8: return 0x27E9; // ⟨ ⟩
    case 0x3008: return 0x3009; // 〈 〉
    default: return 0;
  }
}

static bool is_ident_start(int32_t c) { return c == '_' || iswalpha(c); }
static bool is_ident_char(int32_t c) { return c == '_' || c == '-' || c == '\'' || iswalnum(c); }

// A character that may open a quote-like construct (q{}, rx//, s///, ...).
static bool is_quote_delimiter(int32_t c) {
  if (c == 0 || iswspace(c) || iswalnum(c) || c == '_') return false;
  switch (c) {
    case ';': case ',': case ')': case ']': case '}': case '>': case '=': case '#': case ':':
      return false;
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Serialization

static unsigned serialize(Scanner *s, char *buffer) {
  unsigned size = 0;
  memcpy(&buffer[size], &s->brace_column, sizeof(int16_t));
  size += sizeof(int16_t);
  buffer[size++] = (char)s->string_count;
  for (unsigned i = 0; i < s->string_count; i++) {
    memcpy(&buffer[size], &s->strings[i], sizeof(StringFrame));
    size += sizeof(StringFrame);
  }
  buffer[size++] = (char)s->heredoc_count;
  for (unsigned i = 0; i < s->heredoc_count; i++) {
    Heredoc *h = &s->heredocs[i];
    buffer[size++] = (char)h->length;
    memcpy(&buffer[size], h->chars, h->length * sizeof(int32_t));
    size += h->length * sizeof(int32_t);
  }
  return size;
}

static void deserialize(Scanner *s, const char *buffer, unsigned length) {
  s->brace_column = -1;
  s->string_count = 0;
  s->heredoc_count = 0;
  if (length == 0) return;
  unsigned size = 0;
  memcpy(&s->brace_column, &buffer[size], sizeof(int16_t));
  size += sizeof(int16_t);
  s->string_count = (uint8_t)buffer[size++];
  for (unsigned i = 0; i < s->string_count; i++) {
    memcpy(&s->strings[i], &buffer[size], sizeof(StringFrame));
    size += sizeof(StringFrame);
  }
  s->heredoc_count = (uint8_t)buffer[size++];
  for (unsigned i = 0; i < s->heredoc_count; i++) {
    Heredoc *h = &s->heredocs[i];
    h->length = (uint8_t)buffer[size++];
    memcpy(h->chars, &buffer[size], h->length * sizeof(int32_t));
    size += h->length * sizeof(int32_t);
  }
}

// ---------------------------------------------------------------------------
// Comments and Pod

static void scan_to_eol(TSLexer *lexer) {
  while (!lexer->eof(lexer) && lexer->lookahead != '\n') advance(lexer);
}

// Scans a bracketed region whose opening bracket is the lookahead, honouring
// nesting and repeated brackets such as `#`(( ... ))`.
static bool scan_bracketed(TSLexer *lexer) {
  int32_t open = lexer->lookahead;
  int32_t close = closing_bracket(open);
  if (!close) return false;
  unsigned repeat = 0;
  while (lexer->lookahead == open) {
    advance(lexer);
    repeat++;
  }
  unsigned depth = 1;
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    if (c == close) {
      unsigned n = 0;
      while (lexer->lookahead == close && n < repeat) {
        advance(lexer);
        n++;
      }
      if (n == repeat && --depth == 0) return true;
    } else if (c == open) {
      unsigned n = 0;
      while (lexer->lookahead == open && n < repeat) {
        advance(lexer);
        n++;
      }
      if (n == repeat) depth++;
    } else {
      advance(lexer);
    }
  }
  return true; // unterminated: run to EOF
}

static bool scan_comment(TSLexer *lexer) {
  advance(lexer); // '#'
  int32_t c = lexer->lookahead;
  if (c == '`' || c == '|' || c == '=') {
    advance(lexer);
    if (closing_bracket(lexer->lookahead)) {
      scan_bracketed(lexer);
      lexer->mark_end(lexer);
      lexer->result_symbol = COMMENT;
      return true;
    }
  }
  scan_to_eol(lexer);
  lexer->mark_end(lexer);
  lexer->result_symbol = COMMENT;
  return true;
}

static unsigned read_word(TSLexer *lexer, char *buf, unsigned cap) {
  unsigned n = 0;
  while (iswalnum(lexer->lookahead) || lexer->lookahead == '_' || lexer->lookahead == '-') {
    if (n + 1 < cap) buf[n++] = (char)lexer->lookahead;
    advance(lexer);
  }
  buf[n] = 0;
  return n;
}

static bool is_pod_directive(const char *w) {
  static const char *directives[] = {
    "begin", "end", "for", "para", "code", "comment", "pod", "table", "input", "output",
    "defn", "config", "encoding", "alias", "data", "nested", "finish", "item", "head", "rakudoc",
    NULL,
  };
  for (unsigned i = 0; directives[i]; i++) {
    size_t len = strlen(directives[i]);
    if (strncmp(w, directives[i], len) == 0) {
      // allow trailing digits, e.g. head1, item2
      const char *rest = w + len;
      while (*rest >= '0' && *rest <= '9') rest++;
      if (*rest == 0) return true;
    }
  }
  // Semantic blocks such as =NAME, =AUTHOR, =SYNOPSIS.
  if (w[0] >= 'A' && w[0] <= 'Z') {
    for (const char *p = w; *p; p++) {
      if (!(*p >= 'A' && *p <= 'Z') && *p != '_') return false;
    }
    return true;
  }
  return false;
}

// Skips horizontal whitespace; returns true if the rest of the line is blank.
static bool rest_of_line_blank(TSLexer *lexer) {
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\r') advance(lexer);
  return lexer->eof(lexer) || lexer->lookahead == '\n';
}

static bool scan_pod(TSLexer *lexer) {
  advance(lexer); // '='
  if (!iswalpha(lexer->lookahead)) return false;
  char word[32];
  read_word(lexer, word, sizeof word);
  if (!is_pod_directive(word)) return false;

  if (strcmp(word, "finish") == 0) {
    while (!lexer->eof(lexer)) advance(lexer);
    lexer->mark_end(lexer);
    lexer->result_symbol = POD;
    return true;
  }

  if (strcmp(word, "begin") == 0) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(lexer);
    char name[32];
    read_word(lexer, name, sizeof name);
    // Consume lines until `=end <name>`.
    for (;;) {
      scan_to_eol(lexer);
      lexer->mark_end(lexer);
      if (lexer->eof(lexer)) break;
      advance(lexer); // '\n'
      while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(lexer);
      if (lexer->lookahead != '=') continue;
      advance(lexer);
      char directive[32];
      read_word(lexer, directive, sizeof directive);
      if (strcmp(directive, "end") != 0) continue;
      while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(lexer);
      char end_name[32];
      read_word(lexer, end_name, sizeof end_name);
      if (strcmp(end_name, name) == 0) {
        scan_to_eol(lexer);
        lexer->mark_end(lexer);
        break;
      }
    }
    lexer->result_symbol = POD;
    return true;
  }

  // Paragraph and abbreviated blocks run until a blank line.
  for (;;) {
    scan_to_eol(lexer);
    lexer->mark_end(lexer);
    if (lexer->eof(lexer)) break;
    advance(lexer); // '\n'
    if (rest_of_line_blank(lexer)) break;
  }
  lexer->result_symbol = POD;
  return true;
}

// ---------------------------------------------------------------------------
// Heredocs

static bool scan_heredoc_start(Scanner *s, TSLexer *lexer) {
  int32_t open = lexer->lookahead;
  if (!is_quote_delimiter(open)) return false;
  int32_t close = closing_bracket(open);
  if (!close) close = open;
  advance(lexer);
  Heredoc h = {.length = 0};
  while (!lexer->eof(lexer) && lexer->lookahead != close && lexer->lookahead != '\n') {
    if (h.length < MAX_TERMINATOR) h.chars[h.length++] = lexer->lookahead;
    advance(lexer);
  }
  if (lexer->lookahead != close) return false;
  advance(lexer);
  lexer->mark_end(lexer);
  if (s->heredoc_count < MAX_HEREDOCS) s->heredocs[s->heredoc_count++] = h;
  lexer->result_symbol = HEREDOC_START;
  return true;
}

// Called at the start of the line following a heredoc introducer (possibly
// after leading whitespace was skipped). Consumes up to and including the
// terminator line.
static bool scan_heredoc_body(Scanner *s, TSLexer *lexer) {
  Heredoc h = s->heredocs[0];
  for (;;) {
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t') advance(lexer);
    unsigned i = 0;
    bool matched = true;
    while (i < h.length) {
      if (lexer->lookahead != h.chars[i]) {
        matched = false;
        break;
      }
      advance(lexer);
      i++;
    }
    if (matched && rest_of_line_blank(lexer)) {
      lexer->mark_end(lexer);
      break;
    }
    scan_to_eol(lexer);
    lexer->mark_end(lexer);
    if (lexer->eof(lexer)) break;
    advance(lexer); // '\n'
  }
  s->heredoc_count--;
  memmove(&s->heredocs[0], &s->heredocs[1], s->heredoc_count * sizeof(Heredoc));
  lexer->result_symbol = HEREDOC_BODY;
  return true;
}

// ---------------------------------------------------------------------------
// Quotes and regexes

// Scans the remainder of a quote whose opening delimiter has been consumed.
static bool scan_delimited_rest(TSLexer *lexer, int32_t open, int32_t close, bool regex) {
  unsigned depth = 0;
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    if (c == '\\') {
      advance(lexer);
      if (!lexer->eof(lexer)) advance(lexer);
      continue;
    }
    if (c == close && depth == 0) {
      advance(lexer);
      return true;
    }
    if (open != close) {
      if (c == open) depth++;
      else if (c == close) depth--;
    }
    if (regex && (c == '\'' || c == '"') && c != close) {
      advance(lexer);
      while (!lexer->eof(lexer) && lexer->lookahead != c) {
        if (lexer->lookahead == '\\') advance(lexer);
        if (!lexer->eof(lexer)) advance(lexer);
      }
      if (!lexer->eof(lexer)) advance(lexer);
      continue;
    }
    if (regex && c == '#' && close != '#') {
      scan_to_eol(lexer);
      continue;
    }
    if (regex && c == '<' && open != '<') {
      // Character classes like <[ { } ]> may contain unbalanced delimiters.
      advance(lexer);
      if (lexer->lookahead == '[' || lexer->lookahead == '-' || lexer->lookahead == '+') {
        while (lexer->lookahead == '-' || lexer->lookahead == '+' || lexer->lookahead == ' ') advance(lexer);
        if (lexer->lookahead == '[') {
          advance(lexer);
          while (!lexer->eof(lexer) && lexer->lookahead != ']') {
            if (lexer->lookahead == '\\') advance(lexer);
            if (!lexer->eof(lexer)) advance(lexer);
          }
        }
      }
      continue;
    }
    advance(lexer);
  }
  return false;
}

static bool scan_delimited(TSLexer *lexer, bool regex) {
  int32_t open = lexer->lookahead;
  if (!is_quote_delimiter(open)) return false;
  int32_t close = closing_bracket(open);
  if (!close) close = open;
  advance(lexer);
  return scan_delimited_rest(lexer, open, close, regex);
}

static bool scan_substitution(TSLexer *lexer, const bool *valid_symbols) {
  int32_t open = lexer->lookahead;
  if (!is_quote_delimiter(open)) return false;
  int32_t close = closing_bracket(open);
  advance(lexer);
  if (close) {
    if (!scan_delimited_rest(lexer, open, close, true)) return false;
    lexer->mark_end(lexer);
    // s{...}{...} / tr[...][...]
    while (iswspace(lexer->lookahead)) advance(lexer);
    if (closing_bracket(lexer->lookahead) && lexer->lookahead != '<') {
      if (scan_delimited(lexer, false)) {
        lexer->mark_end(lexer);
        lexer->result_symbol = SUBST_BODY;
        return true;
      }
    }
    if (!valid_symbols[SUBST_PATTERN]) return false;
    lexer->result_symbol = SUBST_PATTERN;
    return true;
  }
  if (!scan_delimited_rest(lexer, open, open, true)) return false;
  if (!scan_delimited_rest(lexer, open, open, false)) return false;
  lexer->mark_end(lexer);
  lexer->result_symbol = SUBST_BODY;
  return true;
}

// ---------------------------------------------------------------------------
// Interpolating strings

static bool push_string(Scanner *s, int32_t open, int32_t close) {
  if (s->string_count >= MAX_STRINGS) return false;
  s->strings[s->string_count++] = (StringFrame){.close = close, .open = open, .depth = 0};
  return true;
}

static bool scan_escape(TSLexer *lexer) {
  advance(lexer); // '\'
  if (lexer->eof(lexer)) return false;
  int32_t c = lexer->lookahead;
  advance(lexer);
  if (c == 'x' || c == 'o' || c == 'c' || c == 'X' || c == 'O' || c == 'C') {
    if (lexer->lookahead == '[') {
      while (!lexer->eof(lexer) && lexer->lookahead != ']') advance(lexer);
      if (!lexer->eof(lexer)) advance(lexer);
    } else if (c == 'x' || c == 'X') {
      while (iswxdigit(lexer->lookahead)) advance(lexer);
    } else if (c == 'o' || c == 'O') {
      while (lexer->lookahead >= '0' && lexer->lookahead <= '7') advance(lexer);
    } else {
      advance(lexer);
    }
  }
  lexer->mark_end(lexer);
  lexer->result_symbol = ESCAPE_SEQUENCE;
  return true;
}

static bool scan_string_content(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
  StringFrame *frame = &s->strings[s->string_count - 1];
  bool braces_are_delimiters = frame->open == '{';
  bool has_content = false;

  if (valid_symbols[INTERPOLATION_POSTFIX]) {
    int32_t c = lexer->lookahead;
    if ((c == '[' || c == '<' || c == '(' || (c == '{' && !braces_are_delimiters)) && c != frame->close) {
      lexer->result_symbol = INTERPOLATION_POSTFIX;
      return true;
    }
    if (c == '.') {
      lexer->mark_end(lexer);
      advance(lexer);
      if (is_ident_start(lexer->lookahead)) {
        while (is_ident_char(lexer->lookahead)) advance(lexer);
        if (lexer->lookahead == '(') {
          lexer->result_symbol = INTERPOLATION_POSTFIX;
          return true;
        }
      }
      // Not a method call: what we consumed is ordinary content.
      has_content = true;
    }
  }

  for (;;) {
    lexer->mark_end(lexer);
    if (lexer->eof(lexer)) break;
    int32_t c = lexer->lookahead;

    if (c == frame->close && frame->depth == 0) {
      if (has_content) break;
      if (!valid_symbols[STRING_END]) return false;
      advance(lexer);
      lexer->mark_end(lexer);
      s->string_count--;
      lexer->result_symbol = STRING_END;
      return true;
    }

    if (c == '\\') {
      if (has_content) break;
      if (!valid_symbols[ESCAPE_SEQUENCE]) return false;
      return scan_escape(lexer);
    }

    if (c == '$') {
      advance(lexer);
      int32_t n = lexer->lookahead;
      bool interpolates = is_ident_start(n) || iswdigit(n) || n == '<' || n == '(' || n == '/';
      if (!interpolates && (n == '.' || n == '!' || n == '*' || n == '?' || n == '^')) {
        advance(lexer);
        interpolates = is_ident_start(lexer->lookahead);
      }
      if (interpolates) {
        if (has_content) break;
        return false; // let the grammar lex the variable
      }
      has_content = true;
      continue;
    }

    if (c == '{' && !braces_are_delimiters) {
      if (has_content) break;
      return false; // interpolated block
    }

    if (c == '@' || c == '%' || c == '&') {
      advance(lexer);
      if (is_ident_start(lexer->lookahead)) {
        while (is_ident_char(lexer->lookahead)) advance(lexer);
        int32_t n = lexer->lookahead;
        if (n == '[' || n == '{' || n == '<' || n == '(') {
          if (has_content) break;
          return false;
        }
      }
      has_content = true;
      continue;
    }

    if (frame->open != frame->close) {
      if (c == frame->open) frame->depth++;
      else if (c == frame->close) frame->depth--;
    }
    advance(lexer);
    has_content = true;
  }

  if (!has_content) return false;
  lexer->result_symbol = STRING_CONTENT;
  return true;
}

// ---------------------------------------------------------------------------
// Entry points

void *tree_sitter_raku_external_scanner_create(void) {
  Scanner *s = calloc(1, sizeof(Scanner));
  s->brace_column = -1;
  return s;
}

void tree_sitter_raku_external_scanner_destroy(void *payload) { free(payload); }

unsigned tree_sitter_raku_external_scanner_serialize(void *payload, char *buffer) {
  return serialize((Scanner *)payload, buffer);
}

void tree_sitter_raku_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  deserialize((Scanner *)payload, buffer, length);
}

static bool scan(Scanner *s, TSLexer *lexer, const bool *valid_symbols);

bool tree_sitter_raku_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  Scanner *s = (Scanner *)payload;
  int16_t brace_column = s->brace_column;
  s->brace_column = -1;
  bool after_brace = brace_column >= 0 && (int16_t)lexer->get_column(lexer) == brace_column;

  if (after_brace && valid_symbols[IMPLICIT_SEMICOLON] && !valid_symbols[ERROR_SENTINEL]) {
    // `}` followed by only spaces/comment up to a newline ends the statement.
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\r') {
      skip(lexer);
    }
    lexer->mark_end(lexer);
    bool line_comment = false;
    if (lexer->lookahead == '#') {
      advance(lexer);
      line_comment = lexer->lookahead != '`';
      if (line_comment) scan_to_eol(lexer);
    }
    if (lexer->lookahead == '\n' || lexer->eof(lexer)) {
      lexer->result_symbol = IMPLICIT_SEMICOLON;
      return true;
    }
    if (line_comment) return false;
  }

  return scan(s, lexer, valid_symbols);
}

static bool scan(Scanner *s, TSLexer *lexer, const bool *valid_symbols) {
  bool error_recovery = valid_symbols[ERROR_SENTINEL];

  // Inside an interpolating string nothing is skipped.
  if (!error_recovery && s->string_count > 0 &&
      (valid_symbols[STRING_CONTENT] || valid_symbols[STRING_END])) {
    return scan_string_content(s, lexer, valid_symbols);
  }

  bool skipped_space = false;
  bool at_line_start = lexer->get_column(lexer) == 0;
  bool crossed_newline = false;
  while (iswspace(lexer->lookahead)) {
    if (lexer->lookahead == '\n') {
      crossed_newline = true;
      at_line_start = true;
    }
    skipped_space = true;
    skip(lexer);
  }

  if (crossed_newline && s->heredoc_count > 0 && valid_symbols[HEREDOC_BODY]) {
    return scan_heredoc_body(s, lexer);
  }

  int32_t c = lexer->lookahead;

  if (c == '#' && valid_symbols[COMMENT]) {
    return scan_comment(lexer);
  }

  if (c == '=' && at_line_start && valid_symbols[POD]) {
    lexer->mark_end(lexer);
    if (scan_pod(lexer)) return true;
    return false;
  }

  if (error_recovery) return false;

  if (valid_symbols[HEREDOC_START] && !skipped_space) {
    return scan_heredoc_start(s, lexer);
  }

  if (valid_symbols[QQ_STRING_START] && !(skipped_space && c == '(')) {
    if (!is_quote_delimiter(c)) return false;
    int32_t close = closing_bracket(c);
    if (!push_string(s, c, close ? close : c)) return false;
    advance(lexer);
    lexer->mark_end(lexer);
    lexer->result_symbol = QQ_STRING_START;
    return true;
  }

  if (valid_symbols[STRING_START] && (c == '"' || c == 0x201C || c == 0x201E)) {
    if (!push_string(s, c, c == '"' ? '"' : 0x201D)) return false;
    advance(lexer);
    lexer->mark_end(lexer);
    lexer->result_symbol = STRING_START;
    return true;
  }

  if (valid_symbols[QUOTE_BODY] && !(skipped_space && c == '(')) {
    if (scan_delimited(lexer, false)) {
      lexer->mark_end(lexer);
      lexer->result_symbol = QUOTE_BODY;
      return true;
    }
    return false;
  }

  if (valid_symbols[REGEX_BODY] && !(skipped_space && c == '(')) {
    if (scan_delimited(lexer, true)) {
      lexer->mark_end(lexer);
      lexer->result_symbol = REGEX_BODY;
      return true;
    }
    return false;
  }

  if ((valid_symbols[SUBST_BODY] || valid_symbols[SUBST_PATTERN]) && !(skipped_space && c == '(')) {
    return scan_substitution(lexer, valid_symbols);
  }

  if (valid_symbols[REGEX_BLOCK] && c == '{') {
    advance(lexer);
    if (scan_delimited_rest(lexer, '{', '}', true)) {
      lexer->mark_end(lexer);
      lexer->result_symbol = REGEX_BLOCK;
      return true;
    }
    return false;
  }

  if (c == '}' && valid_symbols[BLOCK_CLOSE]) {
    advance(lexer);
    lexer->mark_end(lexer);
    s->brace_column = (int16_t)lexer->get_column(lexer);
    lexer->result_symbol = BLOCK_CLOSE;
    return true;
  }

  if (c == '/' && (valid_symbols[REGEX_SLASH] || valid_symbols[SLASH])) {
    advance(lexer);
    int32_t n = lexer->lookahead;
    bool division_ok = valid_symbols[SLASH] && n != '/' && n != '=';
    bool regex_ok = valid_symbols[REGEX_SLASH];
    if (regex_ok && division_ok) {
      // After a bare identifier `foo /x/` is a regex argument but
      // `foo / 2` and `foo/2` are divisions.
      regex_ok = skipped_space && !iswspace(n);
    }
    if (regex_ok) {
      if (scan_delimited_rest(lexer, '/', '/', true)) {
        lexer->mark_end(lexer);
        lexer->result_symbol = REGEX_SLASH;
        return true;
      }
      return false;
    }
    if (division_ok) {
      lexer->mark_end(lexer);
      lexer->result_symbol = SLASH;
      return true;
    }
    return false;
  }

  return false;
}
