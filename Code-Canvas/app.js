/* ──────────────────────────────────────────────────────────────────────────
   CodeCanvas — app.js
   Sections
     1. Examples
     2. Interpreter     (parse a safe Python subset → run it → emit visual events)
     3. Highlighter     (tiny tokenizer for syntax colouring)
     4. initApp()       (everything that touches the DOM)
          Editor · Visualizer · State panels · Console · Execution engine · UI wiring
   ────────────────────────────────────────────────────────────────────────── */

/* ═════════════════════════ 1 · EXAMPLES ═════════════════════════ */

const EXAMPLES = [
  {
    id: "loop",
    name: "For Loop",
    code: `numbers = [2, 4, 6, 8]
total = 0

for number in numbers:
    total = total + number
    print(total)

print("done")
`,
  },
  {
    id: "accumulator",
    name: "Accumulator",
    code: `total = 0
numbers = [5, 10, 15]

for number in numbers:
    total = total + number

print(total)
`,
  },
  {
    id: "condition",
    name: "Condition",
    code: `score = 82

if score >= 50:
    result = "PASS"
else:
    result = "FAIL"

print(result)
`,
  },
  {
    id: "nested",
    name: "Nested Loop",
    code: `# The inner loop runs completely for every step of the outer loop
for row in [1, 2, 3]:
    for col in [10, 20]:
        cell = row * col
        print(cell)
`,
  },
  {
    id: "fibonacci",
    name: "Fibonacci",
    code: `# Each Fibonacci number is the sum of the two before it
a = 0
b = 1

for step in range(8):
    print(a)
    next_value = a + b
    a = b
    b = next_value
`,
  },
];

const README_HTML = `
<h1>CodeCanvas</h1>
<p>Write code → Run it → Watch the logic execute visually.</p>
<h2>HOW TO USE</h2>
<ul>
  <li><b>Run</b> plays the whole program (<code>Ctrl/⌘ + Enter</code>).</li>
  <li><b>Step</b> executes exactly one event — ideal for learning.</li>
  <li><b>Reset</b> clears the visual state. Your code stays.</li>
  <li>Pick an example in the sidebar, or edit <code>main.py</code> freely.</li>
</ul>
<h2>SUPPORTED PYTHON</h2>
<ul>
  <li>Variables, numbers, strings, booleans, lists</li>
  <li>Arithmetic <code>+ - * / // % **</code> and comparisons <code>&gt; &lt; &gt;= &lt;= == !=</code></li>
  <li><code>and</code> / <code>or</code> / <code>not</code>, <code>in</code>, indexing <code>a[0]</code></li>
  <li><code>for</code> loops (lists, strings, <code>range()</code>), <code>while</code>, <code>break</code>, <code>continue</code></li>
  <li><code>if</code> / <code>elif</code> / <code>else</code></li>
  <li><code>print()</code>, <code>list.append()</code>, <code>len range int str abs min max sum</code></li>
</ul>`;

/* ═════════════════════════ 2 · INTERPRETER ═════════════════════════ */

const PyInterp = (() => {
  "use strict";

  class PyError extends Error {
    constructor(message, line, kind = "unsupported", pyName = "", hint = "") {
      super(message);
      this.line = line;
      this.kind = kind;
      this.pyName = pyName;
      this.hint = hint;
    }
  }

  const MAX_STEPS = 500; // visual events per run (guards infinite loops)
  const MAX_RANGE = 5000;
  const KEYWORDS = new Set([
    "for",
    "in",
    "if",
    "elif",
    "else",
    "while",
    "and",
    "or",
    "not",
    "pass",
    "break",
    "continue",
    "def",
    "class",
    "import",
    "from",
    "return",
    "lambda",
    "try",
    "except",
    "finally",
    "with",
    "as",
    "del",
    "global",
    "is",
    "raise",
    "yield",
    "assert",
    "True",
    "False",
    "None",
  ]);
  const UNSUPPORTED_HINTS = {
    def: "Functions are not supported yet.",
    class: "Classes are not supported yet.",
    import: "Imports are not supported.",
    from: "Imports are not supported.",
    return: "Functions are not supported yet.",
    try: "Exceptions are not supported yet.",
    with: '"with" blocks are not supported.',
    lambda: "Lambdas are not supported.",
    del: '"del" is not supported.',
  };

  /* ---------- value helpers ---------- */
  const isNum = (v) => typeof v === "number" || typeof v === "boolean";
  const clone = (v) => (Array.isArray(v) ? v.map(clone) : v);
  const repr = (v) => {
    if (v === null) return "None";
    if (v === true) return "True";
    if (v === false) return "False";
    if (typeof v === "string") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(repr).join(", ") + "]";
    return String(v);
  };
  const str = (v) => (typeof v === "string" ? v : repr(v));
  const typeName = (v) =>
    v === null
      ? "NoneType"
      : Array.isArray(v)
        ? "list"
        : typeof v === "string"
          ? "str"
          : typeof v === "boolean"
            ? "bool"
            : Number.isInteger(v)
              ? "int"
              : "float";
  const truthy = (v) =>
    !(
      v === null ||
      v === false ||
      v === 0 ||
      v === "" ||
      (Array.isArray(v) && v.length === 0)
    );
  const eq = (a, b) => {
    if (isNum(a) && isNum(b)) return +a === +b;
    if (Array.isArray(a) && Array.isArray(b))
      return a.length === b.length && a.every((x, i) => eq(x, b[i]));
    return a === b;
  };
  const rtErr = (name, msg, line) => new PyError(msg, line, "runtime", name);

  /* ---------- tokenizer ---------- */
  const TOKEN_RE =
    /\s*(?:(\d+\.?\d*|\.\d+)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_]\w*)|(\/\/|\*\*|==|!=|<=|>=|[-+*\/%<>()\[\],=.]))/y;
  const ESC = { n: "\n", t: "\t", "\\": "\\", '"': '"', "'": "'" };

  function tokenize(src, line) {
    const toks = [];
    const s = src.trim();
    TOKEN_RE.lastIndex = 0;
    let pos = 0;
    while (pos < s.length) {
      TOKEN_RE.lastIndex = pos;
      const m = TOKEN_RE.exec(s);
      if (!m) {
        const bad = s.slice(pos).trim()[0];
        throw new PyError(`Unsupported character '${bad}'.`, line);
      }
      pos = TOKEN_RE.lastIndex;
      if (m[1] !== undefined) toks.push({ t: "num", v: parseFloat(m[1]) });
      else if (m[2] !== undefined)
        toks.push({
          t: "str",
          v: m[2].slice(1, -1).replace(/\\(.)/g, (_, c) => ESC[c] ?? c),
        });
      else if (m[3] !== undefined) toks.push({ t: "name", v: m[3] });
      else toks.push({ t: "op", v: m[4] });
      if (/^\s*$/.test(s.slice(pos))) break;
    }
    return toks;
  }

  /* ---------- expression parser (recursive descent → AST) ---------- */
  class ExprParser {
    constructor(src, line) {
      this.line = line;
      this.toks = tokenize(src, line);
      this.p = 0;
    }
    peek(o = 0) {
      return this.toks[this.p + o];
    }
    isOp(v) {
      const t = this.peek();
      return !!t && t.t === "op" && t.v === v;
    }
    isName(v, o = 0) {
      const t = this.peek(o);
      return !!t && t.t === "name" && t.v === v;
    }
    fail(msg) {
      throw new PyError(msg, this.line);
    }
    expect(v) {
      if (!this.isOp(v)) this.fail(`Expected '${v}'.`);
      this.p++;
    }
    parse() {
      if (!this.toks.length) this.fail("Expected an expression.");
      const e = this.or();
      if (this.p < this.toks.length)
        this.fail(`Unexpected '${this.peek().v}'.`);
      return e;
    }
    parseArgs() {
      // for print(...) — empty or comma separated
      const args = [];
      while (this.p < this.toks.length) {
        args.push(this.or());
        if (this.isOp(",")) this.p++;
        else break;
      }
      if (this.p < this.toks.length)
        this.fail(`Unexpected '${this.peek().v}'.`);
      return args;
    }
    or() {
      let l = this.and();
      while (this.isName("or")) {
        this.p++;
        l = { k: "or", l, r: this.and() };
      }
      return l;
    }
    and() {
      let l = this.not();
      while (this.isName("and")) {
        this.p++;
        l = { k: "and", l, r: this.not() };
      }
      return l;
    }
    not() {
      if (this.isName("not")) {
        this.p++;
        return { k: "not", e: this.not() };
      }
      return this.cmp();
    }
    cmp() {
      const first = this.add();
      const rest = [];
      for (;;) {
        const t = this.peek();
        let op = null;
        if (!t) break;
        if (t.t === "op" && ["<", ">", "<=", ">=", "==", "!="].includes(t.v)) {
          op = t.v;
          this.p++;
        } else if (this.isName("in")) {
          op = "in";
          this.p++;
        } else if (this.isName("not") && this.isName("in", 1)) {
          op = "not in";
          this.p += 2;
        } else break;
        rest.push({ op, e: this.add() });
      }
      return rest.length ? { k: "cmp", first, rest } : first;
    }
    add() {
      let l = this.mul();
      while (this.isOp("+") || this.isOp("-")) {
        const op = this.peek().v;
        this.p++;
        l = { k: "bin", op, l, r: this.mul() };
      }
      return l;
    }
    mul() {
      let l = this.unary();
      while (["*", "/", "//", "%"].some((o) => this.isOp(o))) {
        const op = this.peek().v;
        this.p++;
        l = { k: "bin", op, l, r: this.unary() };
      }
      return l;
    }
    unary() {
      if (this.isOp("-")) {
        this.p++;
        return { k: "neg", e: this.unary() };
      }
      if (this.isOp("+")) {
        this.p++;
        return this.unary();
      }
      return this.pow();
    }
    pow() {
      const base = this.postfix();
      if (this.isOp("**")) {
        this.p++;
        return { k: "bin", op: "**", l: base, r: this.unary() };
      }
      return base;
    }
    postfix() {
      let e = this.primary();
      for (;;) {
        if (this.isOp("[")) {
          this.p++;
          const idx = this.or();
          this.expect("]");
          e = { k: "index", base: e, idx };
        } else if (this.isOp("(")) {
          if (e.k !== "name") this.fail("Only named functions can be called.");
          this.p++;
          const args = [];
          while (!this.isOp(")")) {
            if (this.p >= this.toks.length) this.fail("Expected ')'.");
            args.push(this.or());
            if (this.isOp(",")) this.p++;
            else break;
          }
          this.expect(")");
          e = { k: "call", name: e.v, args };
        } else if (this.isOp(".")) {
          this.fail(
            "Method calls are only supported as statements, e.g. numbers.append(5).",
          );
        } else break;
      }
      return e;
    }
    primary() {
      const t = this.peek();
      if (!t) this.fail("Unexpected end of expression.");
      this.p++;
      if (t.t === "num") return { k: "lit", v: t.v };
      if (t.t === "str") return { k: "lit", v: t.v };
      if (t.t === "name") {
        if (t.v === "True") return { k: "lit", v: true };
        if (t.v === "False") return { k: "lit", v: false };
        if (t.v === "None") return { k: "lit", v: null };
        if (KEYWORDS.has(t.v)) this.fail(`Unexpected keyword '${t.v}'.`);
        return { k: "name", v: t.v };
      }
      if (t.v === "(") {
        const e = this.or();
        this.expect(")");
        return e;
      }
      if (t.v === "[") {
        const items = [];
        while (!this.isOp("]")) {
          if (this.p >= this.toks.length) this.fail("Expected ']'.");
          items.push(this.or());
          if (this.isOp(",")) this.p++;
          else break;
        }
        this.expect("]");
        return { k: "list", items };
      }
      this.fail(`Unexpected '${t.v}'.`);
    }
  }
  const parseExpr = (src, line) => new ExprParser(src, line).parse();

  /* ---------- statement parser (indentation aware) ---------- */
  function stripComment(s) {
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === "\\") i++;
        else if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === "#") return s.slice(0, i);
    }
    return s;
  }

  function preprocess(rawLines) {
    const out = [];
    rawLines.forEach((raw, i) => {
      const noC = stripComment(raw).replace(/\s+$/, "");
      if (!noC.trim()) return;
      const lead = /^[ \t]*/.exec(noC)[0].replace(/\t/g, "    ");
      out.push({ n: i + 1, indent: lead.length, text: noC.trim() });
    });
    return out;
  }

  const RE_FOR = /^for\s+([A-Za-z_]\w*)\s+in\s+(.+?)\s*:$/;
  const RE_WHILE = /^while\s+(.+?)\s*:$/;
  const RE_IF = /^if\s+(.+?)\s*:$/;
  const RE_ELIF = /^elif\s+(.+?)\s*:$/;
  const RE_ELSE = /^else\s*:$/;
  const RE_PRINT = /^print\s*\((.*)\)$/;
  const RE_APPEND = /^([A-Za-z_]\w*)\.append\((.+)\)$/;
  const RE_ASSIGN =
    /^([A-Za-z_]\w*)\s*(?:\[(.+)\])?\s*(\*\*=|\/\/=|\+=|-=|\*=|\/=|%=|=)(?!=)\s*(.+)$/;

  function parseBlock(ls, i, indent) {
    const stmts = [];
    while (i < ls.length) {
      const L = ls[i];
      if (L.indent < indent) break;
      if (L.indent > indent)
        throw new PyError("Unexpected indentation.", L.n, "syntax");
      const r = parseStatement(ls, i, indent);
      stmts.push(r.stmt);
      i = r.i;
    }
    return { stmts, i };
  }

  function parseStatement(ls, i, indent) {
    const L = ls[i],
      t = L.text,
      n = L.n;
    let m;
    const block = (h) => {
      const nx = ls[h + 1];
      if (!nx || nx.indent <= ls[h].indent)
        throw new PyError("Expected an indented block.", ls[h].n, "syntax");
      return parseBlock(ls, h + 1, nx.indent);
    };

    if ((m = RE_FOR.exec(t))) {
      if (KEYWORDS.has(m[1]))
        throw new PyError(`'${m[1]}' cannot be used as a name.`, n);
      const b = block(i);
      return {
        stmt: {
          k: "for",
          line: n,
          text: t.replace(/:$/, ""),
          v: m[1],
          iter: parseExpr(m[2], n),
          iterSrc: m[2],
          body: b.stmts,
        },
        i: b.i,
      };
    }
    if ((m = RE_WHILE.exec(t))) {
      const b = block(i);
      return {
        stmt: {
          k: "while",
          line: n,
          text: t.replace(/:$/, ""),
          src: m[1],
          cond: parseExpr(m[1], n),
          body: b.stmts,
        },
        i: b.i,
      };
    }
    if ((m = RE_IF.exec(t))) {
      const branches = [];
      let orelse = null;
      let h = i,
        mm = m;
      for (;;) {
        const b = block(h);
        branches.push({
          line: ls[h].n,
          text: ls[h].text.replace(/:$/, ""),
          src: mm[1],
          cond: parseExpr(mm[1], ls[h].n),
          body: b.stmts,
        });
        h = b.i;
        const nx = ls[h];
        if (!nx || nx.indent !== indent) break;
        if ((mm = RE_ELIF.exec(nx.text))) continue;
        if (RE_ELSE.test(nx.text)) {
          const eb = block(h);
          orelse = { line: nx.n, body: eb.stmts };
          h = eb.i;
        }
        break;
      }
      return { stmt: { k: "if", line: n, branches, orelse }, i: h };
    }
    if (/^(elif|else)\b/.test(t)) {
      const w = /^(elif|else)/.exec(t)[1];
      throw new PyError(`'${w}' without a matching 'if'.`, n, "syntax");
    }
    if (t === "pass" || t === "break" || t === "continue")
      return { stmt: { k: t, line: n }, i: i + 1 };
    if ((m = RE_PRINT.exec(t))) {
      return {
        stmt: {
          k: "print",
          line: n,
          text: t,
          args: new ExprParser(m[1], n).parseArgs(),
        },
        i: i + 1,
      };
    }
    if ((m = RE_APPEND.exec(t))) {
      return {
        stmt: {
          k: "append",
          line: n,
          text: t,
          name: m[1],
          expr: parseExpr(m[2], n),
          exprSrc: m[2],
        },
        i: i + 1,
      };
    }
    if ((m = RE_ASSIGN.exec(t)) && !KEYWORDS.has(m[1])) {
      const [, name, idxSrc, op, rhsSrc] = m;
      const rhs = parseExpr(rhsSrc, n);
      const idx = idxSrc !== undefined ? parseExpr(idxSrc, n) : null;
      let expr = rhs,
        exprSrc = rhsSrc;
      if (op !== "=") {
        const bop = op.slice(0, -1);
        const cur = idx
          ? { k: "index", base: { k: "name", v: name }, idx }
          : { k: "name", v: name };
        expr = { k: "bin", op: bop, l: cur, r: rhs };
        const target = idx ? `${name}[${idxSrc}]` : name;
        exprSrc = `${target} ${bop} ${/\s/.test(rhsSrc) ? "(" + rhsSrc + ")" : rhsSrc}`;
      }
      return {
        stmt: {
          k: "assign",
          line: n,
          text: t,
          name,
          idx,
          idxSrc,
          expr,
          exprSrc,
        },
        i: i + 1,
      };
    }
    const kw = /^[A-Za-z_]\w*/.exec(t);
    throw new PyError(
      "Unsupported statement.",
      n,
      "unsupported",
      "",
      (kw && UNSUPPORTED_HINTS[kw[0]]) || "",
    );
  }

  /* ---------- expression evaluation ---------- */
  function binop(op, a, b, line) {
    if (op === "+") {
      if (isNum(a) && isNum(b)) return +a + +b;
      if (typeof a === "string" && typeof b === "string") return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return a.concat(clone(b));
    } else if (op === "*") {
      if (isNum(a) && isNum(b)) return +a * +b;
      if (typeof a === "string" && isNum(b))
        return +b > 0 ? a.repeat(Math.min(+b, 1000)) : "";
      if (isNum(a) && typeof b === "string") return binop("*", b, a, line);
      if (Array.isArray(a) && isNum(b)) {
        let out = [];
        for (let i = 0; i < Math.min(+b, 1000); i++) out = out.concat(clone(a));
        return out;
      }
    } else if (isNum(a) && isNum(b)) {
      const x = +a,
        y = +b;
      if ((op === "/" || op === "//" || op === "%") && y === 0) {
        throw rtErr(
          "ZeroDivisionError",
          op === "%" ? "integer modulo by zero" : "division by zero",
          line,
        );
      }
      switch (op) {
        case "-":
          return x - y;
        case "/":
          return x / y;
        case "//":
          return Math.floor(x / y);
        case "%":
          return ((x % y) + y) % y;
        case "**":
          return Math.pow(x, y);
      }
    }
    throw rtErr(
      "TypeError",
      `unsupported operand type(s) for ${op}: '${typeName(a)}' and '${typeName(b)}'`,
      line,
    );
  }

  function compare(op, a, b, line) {
    switch (op) {
      case "==":
        return eq(a, b);
      case "!=":
        return !eq(a, b);
      case "in":
      case "not in": {
        let r;
        if (Array.isArray(b)) r = b.some((x) => eq(x, a));
        else if (typeof b === "string" && typeof a === "string")
          r = b.includes(a);
        else
          throw rtErr(
            "TypeError",
            `argument of type '${typeName(b)}' is not iterable`,
            line,
          );
        return op === "in" ? r : !r;
      }
    }
    const bothNum = isNum(a) && isNum(b),
      bothStr = typeof a === "string" && typeof b === "string";
    if (!bothNum && !bothStr) {
      throw rtErr(
        "TypeError",
        `'${op}' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`,
        line,
      );
    }
    const x = bothNum ? +a : a,
      y = bothNum ? +b : b;
    return op === "<"
      ? x < y
      : op === ">"
        ? x > y
        : op === "<="
          ? x <= y
          : x >= y;
  }

  const BUILTINS = {
    len: (a, line) => {
      if (typeof a[0] === "string" || Array.isArray(a[0])) return a[0].length;
      throw rtErr(
        "TypeError",
        `object of type '${typeName(a[0])}' has no len()`,
        line,
      );
    },
    range: (a, line) => {
      if (!a.length || a.length > 3 || !a.every((x) => Number.isInteger(x)))
        throw rtErr("TypeError", "range() expects 1 to 3 integers", line);
      let [s, e, st] = a.length === 1 ? [0, a[0], 1] : [a[0], a[1], a[2] ?? 1];
      if (st === 0)
        throw rtErr("ValueError", "range() step must not be zero", line);
      const out = [];
      for (let v = s; st > 0 ? v < e : v > e; v += st) {
        out.push(v);
        if (out.length > MAX_RANGE)
          throw new PyError(
            `range() is too large (limit ${MAX_RANGE}).`,
            line,
            "limit",
          );
      }
      return out;
    },
    int: (a, line) => {
      const v = a[0];
      if (isNum(v)) return Math.trunc(+v);
      if (typeof v === "string" && /^\s*[-+]?\d+\s*$/.test(v))
        return parseInt(v, 10);
      throw rtErr("ValueError", `invalid literal for int(): ${repr(v)}`, line);
    },
    str: (a) => str(a[0]),
    abs: (a, line) => {
      if (!isNum(a[0]))
        throw rtErr(
          "TypeError",
          `bad operand type for abs(): '${typeName(a[0])}'`,
          line,
        );
      return Math.abs(+a[0]);
    },
    min: (a, line) => {
      const xs = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
      if (!xs.length)
        throw rtErr("ValueError", "min() arg is an empty sequence", line);
      return xs.reduce((p, c) => (compare("<", c, p, line) ? c : p));
    },
    max: (a, line) => {
      const xs = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
      if (!xs.length)
        throw rtErr("ValueError", "max() arg is an empty sequence", line);
      return xs.reduce((p, c) => (compare(">", c, p, line) ? c : p));
    },
    sum: (a, line) => {
      if (!Array.isArray(a[0]))
        throw rtErr(
          "TypeError",
          `'${typeName(a[0])}' object is not iterable`,
          line,
        );
      return a[0].reduce((p, c) => binop("+", p, c, line), 0);
    },
  };

  function evalNode(n, env, line) {
    switch (n.k) {
      case "lit":
        return n.v;
      case "name":
        if (!(n.v in env))
          throw rtErr("NameError", `name '${n.v}' is not defined`, line);
        return env[n.v];
      case "list":
        return n.items.map((x) => evalNode(x, env, line));
      case "neg": {
        const v = evalNode(n.e, env, line);
        if (!isNum(v))
          throw rtErr(
            "TypeError",
            `bad operand type for unary -: '${typeName(v)}'`,
            line,
          );
        return -v;
      }
      case "not":
        return !truthy(evalNode(n.e, env, line));
      case "and": {
        const l = evalNode(n.l, env, line);
        return truthy(l) ? evalNode(n.r, env, line) : l;
      }
      case "or": {
        const l = evalNode(n.l, env, line);
        return truthy(l) ? l : evalNode(n.r, env, line);
      }
      case "bin":
        return binop(
          n.op,
          evalNode(n.l, env, line),
          evalNode(n.r, env, line),
          line,
        );
      case "cmp": {
        let l = evalNode(n.first, env, line);
        for (const { op, e } of n.rest) {
          const r = evalNode(e, env, line);
          if (!compare(op, l, r, line)) return false;
          l = r;
        }
        return true;
      }
      case "index": {
        const b = evalNode(n.base, env, line),
          i = evalNode(n.idx, env, line);
        if (!(Array.isArray(b) || typeof b === "string"))
          throw rtErr(
            "TypeError",
            `'${typeName(b)}' object is not subscriptable`,
            line,
          );
        if (!Number.isInteger(i))
          throw rtErr("TypeError", "indices must be integers", line);
        const j = i < 0 ? b.length + i : i;
        if (j < 0 || j >= b.length)
          throw rtErr(
            "IndexError",
            `${Array.isArray(b) ? "list" : "string"} index out of range`,
            line,
          );
        return b[j];
      }
      case "call": {
        const f = BUILTINS[n.name];
        if (!f)
          throw rtErr("NameError", `name '${n.name}' is not defined`, line);
        return f(
          n.args.map((a) => evalNode(a, env, line)),
          line,
        );
      }
    }
    throw new PyError("Unsupported expression.", line);
  }

  /* Replace variable names in an expression with their current values: "score >= 50" → "82 >= 50" */
  function substitute(src, env) {
    return src.replace(
      /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b([A-Za-z_]\w*)\b(?!\s*\()/g,
      (m, s, name) => {
        if (s) return s;
        if (KEYWORDS.has(name) || !(name in env)) return m;
        const v = env[name];
        return Array.isArray(v) ? m : repr(v);
      },
    );
  }

  /* ---------- execution → visual events ---------- */
  function execute(program) {
    const env = Object.create(null);
    const events = [],
      outputs = [];
    let depth = 0;

    const snap = () => {
      const o = {};
      for (const k of Object.keys(env)) o[k] = clone(env[k]);
      return o;
    };
    const emit = (ev) => {
      if (events.length >= MAX_STEPS)
        throw new PyError(
          `Execution stopped after ${MAX_STEPS} steps — is there an infinite loop?`,
          ev.line,
          "limit",
        );
      ev.depth = depth;
      ev.variables = snap();
      ev.description = ev.main;
      events.push(ev);
    };
    const setVar = (name, val) => {
      const had = name in env,
        from = had ? clone(env[name]) : undefined;
      env[name] = val;
      return { [name]: { from, to: clone(val), isNew: !had } };
    };

    function runBlock(stmts) {
      for (const s of stmts) {
        const r = runStmt(s);
        if (r === "break" || r === "continue") return r;
      }
    }

    function runStmt(s) {
      switch (s.k) {
        case "pass":
          return;
        case "break":
        case "continue":
          return s.k;

        case "assign": {
          const val = evalNode(s.expr, env, s.line);
          const calc = substitute(s.exprSrc, env);
          let changes, main;
          if (s.idx) {
            const list = env[s.name];
            if (!(s.name in env))
              throw rtErr(
                "NameError",
                `name '${s.name}' is not defined`,
                s.line,
              );
            if (!Array.isArray(list))
              throw rtErr(
                "TypeError",
                `'${typeName(list)}' object does not support item assignment`,
                s.line,
              );
            const i = evalNode(s.idx, env, s.line);
            if (!Number.isInteger(i))
              throw rtErr("TypeError", "list indices must be integers", s.line);
            const j = i < 0 ? list.length + i : i;
            if (j < 0 || j >= list.length)
              throw rtErr(
                "IndexError",
                "list assignment index out of range",
                s.line,
              );
            const from = clone(list);
            list[j] = val;
            changes = { [s.name]: { from, to: clone(list), isNew: false } };
            main = `${s.name}[${i}] = ${repr(val)}`;
          } else {
            changes = setVar(s.name, val);
            main = `${s.name} = ${repr(val)}`;
          }
          emit({
            line: s.line,
            type: "assignment",
            label: "ASSIGNMENT",
            main,
            sub: s.text,
            calc: calc !== s.exprSrc && calc !== repr(val) ? calc : "",
            changes,
          });
          return;
        }

        case "append": {
          const list = env[s.name];
          if (!(s.name in env))
            throw rtErr("NameError", `name '${s.name}' is not defined`, s.line);
          if (!Array.isArray(list))
            throw rtErr(
              "AttributeError",
              `'${typeName(list)}' object has no attribute 'append'`,
              s.line,
            );
          const val = evalNode(s.expr, env, s.line);
          const from = clone(list);
          list.push(val);
          emit({
            line: s.line,
            type: "assignment",
            label: "LIST APPEND",
            main: `${s.name} = ${repr(list)}`,
            sub: s.text,
            calc: "",
            changes: { [s.name]: { from, to: clone(list), isNew: false } },
          });
          return;
        }

        case "print": {
          const vals = s.args.map((a) => evalNode(a, env, s.line));
          const out = vals.map(str).join(" ");
          outputs.push(out);
          emit({
            line: s.line,
            type: "output",
            label: "OUTPUT",
            main: out === "" ? "(empty line)" : out,
            sub: s.text,
            calc: "",
            changes: {},
            output: out,
          });
          return;
        }

        case "for": {
          const it = evalNode(s.iter, env, s.line);
          let items;
          if (Array.isArray(it)) items = it.slice();
          else if (typeof it === "string") items = it.split("");
          else
            throw rtErr(
              "TypeError",
              `'${typeName(it)}' object is not iterable`,
              s.line,
            );
          for (let k = 0; k < items.length; k++) {
            const changes = setVar(s.v, clone(items[k]));
            emit({
              line: s.line,
              type: "loop",
              label: "LOOP ITERATION",
              main: `${s.v} = ${repr(items[k])}`,
              sub: `${s.text}  ·  ${k + 1} of ${items.length}`,
              calc: "",
              changes,
            });
            depth++;
            let r;
            try {
              r = runBlock(s.body);
            } finally {
              depth--;
            }
            if (r === "break") break;
          }
          return;
        }

        case "while": {
          for (;;) {
            const v = truthy(evalNode(s.cond, env, s.line));
            emit({
              line: s.line,
              type: "condition",
              label: "LOOP CHECK",
              main: s.src,
              sub: v ? `${s.text}  ·  keep looping` : `${s.text}  ·  exit loop`,
              calc: substitute(s.src, env),
              badge: v,
              changes: {},
            });
            if (!v) return;
            depth++;
            let r;
            try {
              r = runBlock(s.body);
            } finally {
              depth--;
            }
            if (r === "break") return;
          }
        }

        case "if": {
          for (let b = 0; b < s.branches.length; b++) {
            const br = s.branches[b];
            const v = truthy(evalNode(br.cond, env, br.line));
            const more = b < s.branches.length - 1 || s.orelse;
            const note = v
              ? "entering this branch"
              : more
                ? "skipping → next branch"
                : "skipping block";
            emit({
              line: br.line,
              type: "condition",
              label: "CONDITION",
              main: br.src,
              sub: `${br.text}  ·  ${note}`,
              calc: substitute(br.src, env),
              badge: v,
              changes: {},
            });
            if (v) {
              depth++;
              let r;
              try {
                r = runBlock(br.body);
              } finally {
                depth--;
              }
              return r;
            }
          }
          if (s.orelse) {
            depth++;
            let r;
            try {
              r = runBlock(s.orelse.body);
            } finally {
              depth--;
            }
            return r;
          }
        }
      }
    }

    let error = null;
    try {
      runBlock(program);
    } catch (e) {
      if (e instanceof PyError) error = e;
      else throw e;
    }
    return { events, outputs, error };
  }

  /* ---------- public API ---------- */
  function run(code) {
    const lines = String(code).replace(/\r\n?/g, "\n").split("\n");
    const attach = (e) => {
      e.text = (lines[e.line - 1] || "").trim();
      return e;
    };
    let program;
    try {
      program = parseBlock(preprocess(lines), 0, 0).stmts;
    } catch (e) {
      if (e instanceof PyError)
        return { phase: "parse", events: [], outputs: [], error: attach(e) };
      throw e;
    }
    const res = execute(program);
    if (res.error) attach(res.error);
    return { phase: "run", ...res };
  }

  return { run, repr, typeName, PyError, MAX_STEPS };
})();

/* ═════════════════════════ 3 · HIGHLIGHTER ═════════════════════════ */

const HL_KEYWORDS = new Set([
  "for",
  "in",
  "if",
  "elif",
  "else",
  "while",
  "and",
  "or",
  "not",
  "pass",
  "break",
  "continue",
  "def",
  "class",
  "import",
  "from",
  "return",
  "is",
]);
const HL_CONST = new Set(["True", "False", "None"]);
const HL_BUILTIN = new Set([
  "print",
  "range",
  "len",
  "int",
  "str",
  "abs",
  "min",
  "max",
  "sum",
]);
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function highlightLine(line) {
  const re =
    /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+\.?\d*\b)|([A-Za-z_]\w*)|([-+*\/%<>=!]+)|([\s\S])/g;
  let out = "",
    m;
  while ((m = re.exec(line))) {
    if (m[1]) out += `<span class="tk-com">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-num">${m[3]}</span>`;
    else if (m[4]) {
      const w = m[4],
        next = line.slice(re.lastIndex).trimStart()[0];
      if (HL_KEYWORDS.has(w)) out += `<span class="tk-kw">${w}</span>`;
      else if (HL_CONST.has(w)) out += `<span class="tk-const">${w}</span>`;
      else if (HL_BUILTIN.has(w) || next === "(")
        out += `<span class="tk-fn">${w}</span>`;
      else out += w;
    } else if (m[5]) out += `<span class="tk-op">${esc(m[5])}</span>`;
    else out += esc(m[6]);
  }
  return out;
}
const highlight = (src) => src.split("\n").map(highlightLine).join("\n");

/* ═════════════════════════ 4 · APP (DOM) ═════════════════════════ */

function initApp() {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const restart = (el, cls) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };
  const LH = 22,
    PAD = 14;

  /* ───────── Editor ───────── */
  class CodeEditor {
    constructor() {
      this.ta = $("#code");
      this.hl = $("#hl");
      this.hlCode = $("#hlCode");
      this.gut = $("#gutterInner");
      this.bars = $("#barsInner");
      this.cur = $("#curLine");
      this.exec = $("#execLine");
      this.body = $("#editorBody");
      this.lineCount = 0;
      this.activeLine = 0;
      this.onChange = null;

      this.ta.addEventListener("input", () => {
        this.render();
        this.onChange && this.onChange();
      });
      this.ta.addEventListener("scroll", () => this.syncScroll());
      ["keyup", "click", "focus", "blur", "select"].forEach((ev) =>
        this.ta.addEventListener(ev, () => this.updateCursor()),
      );
      this.ta.addEventListener("keydown", (e) => this.onKey(e));
    }
    get value() {
      return this.ta.value;
    }
    set value(v) {
      this.ta.value = v;
      this.ta.scrollTop = 0;
      this.ta.scrollLeft = 0;
      this.render();
    }
    render() {
      const v = this.ta.value;
      this.hlCode.innerHTML = highlight(v) + "\n";
      const n = v.split("\n").length;
      if (n !== this.lineCount) {
        this.lineCount = n;
        this.gut.innerHTML = "";
        for (let i = 1; i <= n; i++)
          this.gut.appendChild(h("div", "", String(i)));
        if (this.activeLine) this.markGutter();
      }
      this.syncScroll();
      this.updateCursor();
    }
    syncScroll() {
      const y = this.ta.scrollTop,
        x = this.ta.scrollLeft;
      this.hl.style.transform = `translate(${-x}px, ${-y}px)`;
      this.gut.style.transform = `translateY(${-y}px)`;
      this.bars.style.transform = `translateY(${-y}px)`;
    }
    lineTop(n) {
      return PAD + (n - 1) * LH;
    }
    updateCursor() {
      const focused =
        document.activeElement === this.ta &&
        this.ta.selectionStart === this.ta.selectionEnd;
      if (!focused) {
        this.cur.classList.remove("show");
        return;
      }
      const line = this.ta.value
        .slice(0, this.ta.selectionStart)
        .split("\n").length;
      this.cur.style.top = this.lineTop(line) + "px";
      this.cur.classList.add("show");
    }
    markGutter(kind) {
      $$("#gutterInner div", this.body).forEach((d, i) => {
        const on = i + 1 === this.activeLine;
        d.classList.toggle("on", on);
        d.classList.toggle("err", on && kind === "err");
      });
    }
    /** Highlight the line being executed (or an error line). n = 0 clears. */
    setExec(n, kind) {
      this.activeLine = n || 0;
      this.body.classList.toggle("executing", !!n);
      if (!n) {
        this.exec.classList.remove("show", "err");
        this.markGutter();
        return;
      }
      this.exec.style.top = this.lineTop(n) + "px";
      this.exec.classList.add("show");
      this.exec.classList.toggle("err", kind === "err");
      this.markGutter(kind);
      const top = this.lineTop(n),
        bottom = top + LH,
        ta = this.ta;
      if (top < ta.scrollTop + 8)
        ta.scrollTo
          ? ta.scrollTo({ top: Math.max(0, top - 40), behavior: "smooth" })
          : (ta.scrollTop = Math.max(0, top - 40));
      else if (
        bottom > ta.scrollTop + ta.clientHeight - 24 &&
        ta.clientHeight > 0
      )
        ta.scrollTo
          ? ta.scrollTo({
              top: bottom - ta.clientHeight + 48,
              behavior: "smooth",
            })
          : (ta.scrollTop = bottom - ta.clientHeight + 48);
    }
    insert(text) {
      this.ta.focus();
      if (
        typeof document.execCommand === "function" &&
        document.execCommand("insertText", false, text)
      )
        return;
      const s = this.ta.selectionStart;
      this.ta.setRangeText(text, s, this.ta.selectionEnd, "end");
      this.ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    onKey(e) {
      if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        this.insert("    ");
      } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const before = this.ta.value.slice(0, this.ta.selectionStart);
        const line = before.slice(before.lastIndexOf("\n") + 1);
        const indent =
          /^[ \t]*/.exec(line)[0] + (/:\s*$/.test(line) ? "    " : "");
        if (indent) {
          e.preventDefault();
          this.insert("\n" + indent);
        }
      }
    }
  }

  /* ───────── Visualizer (Execution Canvas) ───────── */
  const Viz = {
    scroller: $("#canvasScroll"),
    flow: $("#flow"),
    empty: $("#empty"),
    errPanel: $("#errPanel"),
    panel: $("#canvasPanel"),
    last: null,
    setSpeed(s) {
      this.panel.style.setProperty("--k", String(1 / s));
    },
    clear() {
      this.flow.innerHTML = "";
      this.last = null;
      this.empty.hidden = false;
      this.errPanel.hidden = true;
      this.scroller.scrollTop = 0;
    },
    connector() {
      const c = h("div", "conn");
      c.appendChild(h("i", "dot"));
      this.flow.appendChild(c);
    },
    place(node) {
      this.empty.hidden = true;
      this.errPanel.hidden = true;
      if (this.last) {
        this.last.classList.remove("active");
        this.last.classList.add("done");
        this.connector();
      }
      this.flow.appendChild(node);
      this.last = node;
      requestAnimationFrame(() => {
        const r = node.getBoundingClientRect(),
          s = this.scroller.getBoundingClientRect();
        const delta = r.bottom - s.bottom + 70;
        if (delta > 0)
          this.scroller.scrollBy
            ? this.scroller.scrollBy({ top: delta, behavior: "smooth" })
            : (this.scroller.scrollTop += delta);
      });
    },
    add(ev, i) {
      const n = h("div", `node t-${ev.type} active`);
      n.style.setProperty("--depth", Math.min(ev.depth, 4));
      const head = h("div", "n-head");
      head.append(
        h("span", "n-tag", ev.label),
        h("span", "n-meta", `#${i + 1} · L${ev.line}`),
      );
      const main = h("div", "n-main");
      main.appendChild(h("span", "txt", ev.main));
      if (typeof ev.badge === "boolean")
        main.appendChild(
          h(
            "span",
            `pill ${ev.badge ? "t" : "f"}`,
            ev.badge ? "True" : "False",
          ),
        );
      n.append(head, main);
      if (ev.calc) n.appendChild(h("div", "n-calc", "↳ " + ev.calc));
      if (ev.sub) n.appendChild(h("div", "n-sub", ev.sub));
      this.place(n);
    },
    addError(err) {
      const n = h("div", "node t-error active");
      n.style.setProperty("--depth", 0);
      const head = h("div", "n-head");
      head.append(
        h("span", "n-tag", "RUNTIME ERROR"),
        h("span", "n-meta", `L${err.line}`),
      );
      n.append(
        head,
        h("div", "n-main", `${err.pyName || "Error"}: ${err.message}`),
      );
      if (err.text) n.appendChild(h("div", "n-sub", err.text));
      this.place(n);
    },
    showParseError(err) {
      this.flow.innerHTML = "";
      this.last = null;
      this.empty.hidden = true;
      const p = this.errPanel;
      p.innerHTML = "";
      p.hidden = false;
      p.appendChild(h("h3", "", "⚠ Unsupported syntax"));
      p.appendChild(h("div", "lbl", "CODECANVAS CURRENTLY SUPPORTS"));
      const ul = h("ul");
      [
        "Variables",
        "Arrays",
        "Arithmetic",
        "for / while loops",
        "if / elif / else",
        "print()",
      ].forEach((t) => ul.appendChild(h("li", "", t)));
      p.appendChild(ul);
      p.appendChild(h("div", "lbl", `LINE ${err.line}`));
      if (err.text) p.appendChild(h("div", "where", err.text));
      p.appendChild(h("div", "msg", err.message));
      if (err.hint) p.appendChild(h("div", "hintline", err.hint));
    },
  };

  /* ───────── State panels ───────── */
  const Vars = {
    el: $("#vars"),
    count: $("#varCount"),
    rows: new Map(),
    clear() {
      this.rows.clear();
      this.el.innerHTML =
        '<p class="muted-note">Variables appear here as your program creates them.</p>';
      this.count.textContent = "0";
    },
    fill(valEl, v, cls) {
      valEl.innerHTML = "";
      if (Array.isArray(v)) {
        const chips = h("span", "chips");
        v.forEach((x) =>
          chips.appendChild(h("span", "chip", PyInterp.repr(x))),
        );
        valEl.appendChild(chips);
        return chips;
      }
      const now = h(
        "span",
        `now ${typeof v === "string" ? "str" : typeof v === "boolean" ? "bool" : ""}`,
        PyInterp.repr(v),
      );
      valEl.appendChild(now);
      return now;
    },
    update(ev) {
      if (this.rows.size === 0) this.el.innerHTML = "";
      for (const name of Object.keys(ev.variables)) {
        const v = ev.variables[name];
        const ch = ev.changes[name];
        let row = this.rows.get(name);
        if (!row) {
          const el = h("div", "var");
          const vn = h("span", "vn", name),
            ty = h("span", "ty", PyInterp.typeName(v)),
            vv = h("span", "vv");
          el.append(vn, ty, vv);
          this.el.appendChild(el);
          row = { el, ty, vv };
          this.rows.set(name, row);
          this.fill(vv, v);
          if (ch) restart(el, "flash");
          continue;
        }
        if (ch) {
          const was = ch.from;
          row.ty.textContent = PyInterp.typeName(v);
          const now = this.fill(row.vv, v);
          if (was !== undefined && !Array.isArray(v)) {
            const w = h("span", "was", PyInterp.repr(was));
            w.addEventListener("animationend", () => w.remove());
            row.vv.insertBefore(w, now);
            restart(now, "pop");
          } else if (Array.isArray(v)) {
            const kids = $$(".chip", row.vv);
            const old = Array.isArray(was) ? was.length : 0;
            kids.forEach((c, i) => {
              if (i >= old || PyInterp.repr(was && was[i]) !== c.textContent)
                c.classList.add("new");
            });
          }
          restart(row.el, "flash");
        }
      }
      this.count.textContent = String(this.rows.size);
    },
  };

  const Progress = {
    now: $("#stepNow"),
    total: $("#stepTotal"),
    pct: $("#pct"),
    fill: $("#barFill"),
    rt: $("#runtime"),
    reset() {
      this.now.textContent = "0";
      this.total.textContent = "0";
      this.pct.textContent = "0%";
      this.fill.style.width = "0%";
      this.fill.className = "bar-fill";
      this.rt.textContent = "— ms";
    },
    set(i, n, ms) {
      this.now.textContent = i;
      this.total.textContent = n;
      const p = n ? Math.round((i / n) * 100) : 0;
      this.pct.textContent = p + "%";
      this.fill.style.width = p + "%";
      this.rt.textContent = ms + " ms";
    },
    state(s) {
      this.fill.className = "bar-fill" + (s ? " " + s : "");
    },
  };

  const Feed = {
    el: $("#feed"),
    clear() {
      this.el.innerHTML = "";
    },
    add(ev, i) {
      const prev = this.el.querySelector(".active");
      if (prev) prev.classList.remove("active");
      const li = h("li", `ev t-${ev.type} active`);
      const top = h("div", "top");
      top.append(
        h("span", "l", "L" + ev.line),
        h("span", "t", ev.label.toLowerCase()),
      );
      li.append(top, h("div", "d", ev.main));
      this.el.prepend(li);
      while (this.el.children.length > 250) this.el.lastChild.remove();
    },
    addError(err) {
      const prev = this.el.querySelector(".active");
      if (prev) prev.classList.remove("active");
      const li = h("li", "ev t-error active");
      const top = h("div", "top");
      top.append(h("span", "l", "L" + err.line), h("span", "t", "error"));
      li.append(top, h("div", "d", `${err.pyName || "Error"}: ${err.message}`));
      this.el.prepend(li);
    },
  };

  /* ───────── Console ───────── */
  const Log = {
    panes: {
      console: $("#pane-console"),
      output: $("#pane-output"),
      events: $("#pane-events"),
    },
    clear() {
      Object.values(this.panes).forEach((p) => (p.innerHTML = ""));
    },
    write(pane, kind, text) {
      const p = this.panes[pane];
      const l = h("div", "ln " + kind, text);
      p.appendChild(l);
      const body = p.parentElement;
      body.scrollTop = body.scrollHeight;
      return l;
    },
    out(kind, text) {
      return this.write("console", kind, text);
    },
    step(ev, i) {
      this.out("dim", `→ Line ${ev.line}`);
      if (ev.type === "output") this.write("output", "out", ev.output);
      const l = this.write("events", "", "");
      l.append(
        h("span", "ln-n", String(i + 1).padStart(2, "0")),
        h("span", "ln-t", `L${ev.line}`),
        document.createTextNode(`${ev.label.toLowerCase()}  ${ev.main}`),
      );
    },
  };

  /* ───────── Execution engine (playback + state machine) ───────── */
  const Editor = new CodeEditor();
  const statusEl = $("#status"),
    statusText = $("#statusText");
  const runBtn = $("#runBtn"),
    runIcon = $("#runIcon"),
    runLabel = $("#runLabel");
  const UI = {
    idle: {
      s: "idle",
      text: "Runtime ready",
      icon: "▶",
      label: "Run",
      cls: "",
      tip: "Ctrl / ⌘ + Enter",
    },
    running: {
      s: "running",
      text: "Executing…",
      icon: "●",
      label: "Running...",
      cls: "running",
      tip: "Click to pause",
    },
    paused: {
      s: "paused",
      text: "Paused",
      icon: "▶",
      label: "Resume",
      cls: "paused",
      tip: "Resume playback",
    },
    done: {
      s: "idle",
      text: "Execution complete",
      icon: "✓",
      label: "Completed",
      cls: "done",
      tip: "Run again",
    },
    error: {
      s: "error",
      text: "Error",
      icon: "⚠",
      label: "Failed",
      cls: "error",
      tip: "Fix the code, then run again",
    },
  };

  const Engine = {
    session: null,
    idx: -1,
    status: "idle",
    timer: null,
    speed: 1,

    setStatus(st, textOverride) {
      this.status = st;
      const u = UI[st];
      statusEl.dataset.state = u.s;
      statusText.textContent = textOverride || u.text;
      runBtn.className = "btn primary " + u.cls;
      runIcon.textContent = u.icon;
      runLabel.textContent = u.label;
      runBtn.dataset.tip = u.tip;
    },

    /** Clear all visual execution state (keeps code and console). */
    resetExec() {
      clearTimeout(this.timer);
      this.timer = null;
      this.session = null;
      this.idx = -1;
      Viz.clear();
      Vars.clear();
      Feed.clear();
      Progress.reset();
      Editor.setExec(0);
      this.setStatus("idle");
    },

    /** Compile the editor contents. Returns false if the program can't start. */
    begin() {
      this.resetExec();
      Log.clear();
      Log.out("ok", "✓ Runtime initialized.");
      const t0 = performance.now();
      const res = PyInterp.run(Editor.value);
      const ms = performance.now() - t0;

      if (res.phase === "parse") {
        const e = res.error;
        Log.out("gap err", `✗ Unsupported syntax on line ${e.line}`);
        Log.out("err", e.message + (e.hint ? " " + e.hint : ""));
        if (e.text) Log.out("dim", `  ${e.line} │ ${e.text}`);
        Viz.showParseError(e);
        Editor.setExec(e.line, "err");
        this.setStatus("error", "Unsupported syntax");
        return false;
      }
      if (!res.events.length && !res.error) {
        Log.out("warn", "⚠ Nothing to execute — write some code first.");
        return false;
      }
      this.session = { ...res, compileMs: ms };
      Progress.set(0, res.events.length, 0);
      Log.out("gap head", "▶ Execution started.");
      this.setStatus("paused");
      return true;
    },

    apply(i) {
      const ev = this.session.events[i];
      Editor.setExec(ev.line);
      Viz.add(ev, i);
      Vars.update(ev);
      Feed.add(ev, i);
      Log.step(ev, i);
      Progress.set(
        i + 1,
        this.session.events.length,
        Math.max(1, Math.round(this.session.compileMs + (i + 1) * 1.3)),
      );
    },

    finish() {
      clearTimeout(this.timer);
      this.timer = null;
      const s = this.session,
        err = s.error;
      if (err) {
        Viz.addError(err);
        Feed.addError(err);
        Editor.setExec(err.line, "err");
        Progress.state("error");
        Log.out("gap err", `✗ ${err.pyName || "Error"}: ${err.message}`);
        Log.out("dim", `  line ${err.line}${err.text ? " │ " + err.text : ""}`);
        Log.write(
          "events",
          "err",
          `✗ ${err.pyName || "Error"}: ${err.message}`,
        );
        this.setStatus(
          "error",
          err.kind === "limit" ? "Step limit reached" : "Runtime error",
        );
      } else {
        Progress.state("done");
        Log.out("gap ok", "✓ Execution completed.");
        if (s.outputs.length) {
          Log.out("gap head", "Output:");
          s.outputs.forEach((o) => Log.out("out", o));
        }
        this.setStatus("done");
        setTimeout(() => {
          if (this.status === "done") Editor.setExec(0);
        }, 900);
      }
    },

    step() {
      if (this.status === "running") this.pause();
      if (this.status === "done" || this.status === "error") this.resetExec();
      if (!this.session && !this.begin()) return;
      const n = this.session.events.length;
      if (this.idx < n - 1) {
        this.idx++;
        this.apply(this.idx);
      }
      if (this.idx >= n - 1) this.finish();
    },

    pause() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.status === "running") this.setStatus("paused");
    },

    run() {
      if (this.status === "running") {
        this.pause();
        return;
      }
      if (this.status === "done" || this.status === "error") this.resetExec();
      if (!this.session && !this.begin()) return;
      this.setStatus("running");
      this.tick();
    },

    tick() {
      if (this.status !== "running") return;
      const n = this.session.events.length;
      if (this.idx < n - 1) {
        this.idx++;
        this.apply(this.idx);
      }
      if (this.idx >= n - 1) {
        this.finish();
        return;
      }
      this.timer = setTimeout(() => this.tick(), 720 / this.speed);
    },

    setSpeed(s) {
      this.speed = s;
      Viz.setSpeed(s);
    },
  };

  /* ───────── UI wiring ───────── */
  let activeExample = EXAMPLES[0].id;

  function loadExample(ex) {
    activeExample = ex.id;
    Editor.value = ex.code;
    Engine.resetExec();
    Log.clear();
    Log.out("ok", "✓ Runtime initialized.");
    Log.out(
      "dim",
      `Loaded example “${ex.name}”. Press Run or Ctrl / ⌘ + Enter.`,
    );
    $$(".ex").forEach((b) =>
      b.classList.toggle("active", b.dataset.id === ex.id),
    );
    showFile("main.py");
    closeDrawer();
  }

  // Explorer examples
  const exWrap = $("#examples");
  EXAMPLES.forEach((ex, i) => {
    const b = h("button", "ex" + (i === 0 ? " active" : ""));
    b.dataset.id = ex.id;
    b.append(
      h("span", "num", String(i + 1).padStart(2, "0")),
      h("span", "dotsep", "·"),
      document.createTextNode(" " + ex.name),
    );
    b.addEventListener("click", () => loadExample(ex));
    exWrap.appendChild(b);
  });

  // Files
  const readme = $("#readmeView"),
    editorBody = $("#editorBody");
  readme.innerHTML = README_HTML;
  function showFile(name) {
    const isReadme = name === "README.md";
    readme.hidden = !isReadme;
    editorBody.style.visibility = isReadme ? "hidden" : "visible";
    $("#fileName").textContent = name;
    $("#fileGlyph").textContent = isReadme ? "◇" : "◆";
    $$(".file").forEach((f) =>
      f.classList.toggle("active", f.dataset.file === name),
    );
    if (!isReadme) Editor.ta.focus({ preventScroll: true });
  }
  $$(".file").forEach((f) =>
    f.addEventListener("click", () => {
      showFile(f.dataset.file);
      closeDrawer();
    }),
  );

  // Drawer (tablet / mobile)
  const sidebar = $("#sidebar"),
    scrim = $("#scrim");
  const closeDrawer = () => {
    sidebar.classList.remove("open");
    scrim.classList.remove("show");
  };
  $("#menuBtn").addEventListener("click", () => {
    const o = sidebar.classList.toggle("open");
    scrim.classList.toggle("show", o);
  });
  scrim.addEventListener("click", closeDrawer);

  // Collapsible panels (shown on tablet / mobile)
  $$("[data-collapse]").forEach((b) =>
    b.addEventListener("click", () =>
      b.closest(".panel").classList.toggle("collapsed"),
    ),
  );

  // Console tabs
  $$("#consoleTabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$("#consoleTabs .tab").forEach((x) =>
        x.classList.toggle("active", x === t),
      );
      $$(".pane").forEach((p) =>
        p.classList.toggle("active", p.id === "pane-" + t.dataset.tab),
      );
    }),
  );

  // Speed
  $$("#speed button").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#speed button").forEach((x) => x.classList.toggle("active", x === b));
      Engine.setSpeed(parseFloat(b.dataset.speed));
    }),
  );

  // Buttons
  const runPressed = () => {
    showFile("main.py");
    Engine.run();
  };
  runBtn.addEventListener("click", runPressed);
  $("#emptyRun").addEventListener("click", runPressed);
  $("#stepBtn").addEventListener("click", () => {
    showFile("main.py");
    Engine.step();
  });
  $("#resetBtn").addEventListener("click", () => {
    Engine.resetExec();
    Log.clear();
    Log.out("ok", "✓ Runtime initialized.");
    Log.out("dim", "↻ Reset. Ready to run.");
  });

  // Keyboard: Ctrl/Cmd + Enter
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runPressed();
    }
  });

  // Editing invalidates any running / finished visualization
  Editor.onChange = () => {
    if (Engine.status !== "idle" || Engine.session) Engine.resetExec();
  };

  // Boot
  Engine.setSpeed(1);
  Editor.value = EXAMPLES[0].code;
  Log.out("ok", "✓ Runtime initialized.");
  Log.out("dim", "Press Run or Ctrl / ⌘ + Enter to watch main.py execute.");

  // Expose for debugging / tests
  window.CodeCanvas = { Engine, Editor, Viz, Vars, Log, PyInterp };
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initApp);
  else initApp();
}
if (typeof module !== "undefined" && module.exports)
  module.exports = { PyInterp, highlight, EXAMPLES };
