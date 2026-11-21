// Named character references for book text (spec.md V-30): all 252 of XHTML 1.0 / HTML 4 (EPUB 2 books use them),
// and the HTML5 names of Latin Extended-A letters (Polish, Czech, Hungarian… diacritics). Generated from Python's
// html.entities; numeric references are decoded separately (html.ts).

/** XHTML 1.0 (HTML 4.01): Latin-1, symbols and special characters. */
const xhtml: Record<string, string> = {
  Aacute: 'Á', aacute: 'á', Acirc: 'Â', acirc: 'â', acute: '´', AElig: 'Æ', aelig: 'æ', Agrave: 'À', agrave: 'à',
  alefsym: 'ℵ', Alpha: 'Α', alpha: 'α', amp: '&', and: '∧', ang: '∠', Aring: 'Å', aring: 'å', asymp: '≈',
  Atilde: 'Ã', atilde: 'ã', Auml: 'Ä', auml: 'ä', bdquo: '„', Beta: 'Β', beta: 'β', brvbar: '¦', bull: '•', cap: '∩',
  Ccedil: 'Ç', ccedil: 'ç', cedil: '¸', cent: '¢', Chi: 'Χ', chi: 'χ', circ: 'ˆ', clubs: '♣', cong: '≅', copy: '©',
  crarr: '↵', cup: '∪', curren: '¤', Dagger: '‡', dagger: '†', dArr: '⇓', darr: '↓', deg: '°', Delta: 'Δ',
  delta: 'δ', diams: '♦', divide: '÷', Eacute: 'É', eacute: 'é', Ecirc: 'Ê', ecirc: 'ê', Egrave: 'È', egrave: 'è',
  empty: '∅', emsp: '\u2003', ensp: '\u2002', Epsilon: 'Ε', epsilon: 'ε', equiv: '≡', Eta: 'Η', eta: 'η', ETH: 'Ð',
  eth: 'ð', Euml: 'Ë', euml: 'ë', euro: '€', exist: '∃', fnof: 'ƒ', forall: '∀', frac12: '½', frac14: '¼',
  frac34: '¾', frasl: '⁄', Gamma: 'Γ', gamma: 'γ', ge: '≥', gt: '>', hArr: '⇔', harr: '↔', hearts: '♥', hellip: '…',
  Iacute: 'Í', iacute: 'í', Icirc: 'Î', icirc: 'î', iexcl: '¡', Igrave: 'Ì', igrave: 'ì', image: 'ℑ', infin: '∞',
  int: '∫', Iota: 'Ι', iota: 'ι', iquest: '¿', isin: '∈', Iuml: 'Ï', iuml: 'ï', Kappa: 'Κ', kappa: 'κ', Lambda: 'Λ',
  lambda: 'λ', lang: '〈', laquo: '«', lArr: '⇐', larr: '←', lceil: '⌈', ldquo: '“', le: '≤', lfloor: '⌊',
  lowast: '∗', loz: '◊', lrm: '\u200e', lsaquo: '‹', lsquo: '‘', lt: '<', macr: '¯', mdash: '—', micro: 'µ',
  middot: '·', minus: '−', Mu: 'Μ', mu: 'μ', nabla: '∇', nbsp: '\u00a0', ndash: '–', ne: '≠', ni: '∋', not: '¬',
  notin: '∉', nsub: '⊄', Ntilde: 'Ñ', ntilde: 'ñ', Nu: 'Ν', nu: 'ν', Oacute: 'Ó', oacute: 'ó', Ocirc: 'Ô',
  ocirc: 'ô', OElig: 'Œ', oelig: 'œ', Ograve: 'Ò', ograve: 'ò', oline: '‾', Omega: 'Ω', omega: 'ω', Omicron: 'Ο',
  omicron: 'ο', oplus: '⊕', or: '∨', ordf: 'ª', ordm: 'º', Oslash: 'Ø', oslash: 'ø', Otilde: 'Õ', otilde: 'õ',
  otimes: '⊗', Ouml: 'Ö', ouml: 'ö', para: '¶', part: '∂', permil: '‰', perp: '⊥', Phi: 'Φ', phi: 'φ', Pi: 'Π',
  pi: 'π', piv: 'ϖ', plusmn: '±', pound: '£', Prime: '″', prime: '′', prod: '∏', prop: '∝', Psi: 'Ψ', psi: 'ψ',
  quot: '"', radic: '√', rang: '〉', raquo: '»', rArr: '⇒', rarr: '→', rceil: '⌉', rdquo: '”', real: 'ℜ', reg: '®',
  rfloor: '⌋', Rho: 'Ρ', rho: 'ρ', rlm: '\u200f', rsaquo: '›', rsquo: '’', sbquo: '‚', Scaron: 'Š', scaron: 'š',
  sdot: '⋅', sect: '§', shy: '\u00ad', Sigma: 'Σ', sigma: 'σ', sigmaf: 'ς', sim: '∼', spades: '♠', sub: '⊂',
  sube: '⊆', sum: '∑', sup: '⊃', sup1: '¹', sup2: '²', sup3: '³', supe: '⊇', szlig: 'ß', Tau: 'Τ', tau: 'τ',
  there4: '∴', Theta: 'Θ', theta: 'θ', thetasym: 'ϑ', thinsp: '\u2009', THORN: 'Þ', thorn: 'þ', tilde: '˜',
  times: '×', trade: '™', Uacute: 'Ú', uacute: 'ú', uArr: '⇑', uarr: '↑', Ucirc: 'Û', ucirc: 'û', Ugrave: 'Ù',
  ugrave: 'ù', uml: '¨', upsih: 'ϒ', Upsilon: 'Υ', upsilon: 'υ', Uuml: 'Ü', uuml: 'ü', weierp: '℘', Xi: 'Ξ', xi: 'ξ',
  Yacute: 'Ý', yacute: 'ý', yen: '¥', Yuml: 'Ÿ', yuml: 'ÿ', Zeta: 'Ζ', zeta: 'ζ', zwj: '\u200d', zwnj: '\u200c',
}

/** HTML5 names of U+0100–U+017F letters, e.g. «aogon» → «ą», «lstrok» → «ł», «zdot» → «ż». */
const latinExtendedA: Record<string, string> = {
  Abreve: 'Ă', abreve: 'ă', Amacr: 'Ā', amacr: 'ā', Aogon: 'Ą', aogon: 'ą', Cacute: 'Ć', cacute: 'ć', Ccaron: 'Č',
  ccaron: 'č', Ccirc: 'Ĉ', ccirc: 'ĉ', Cdot: 'Ċ', cdot: 'ċ', Dcaron: 'Ď', dcaron: 'ď', Dstrok: 'Đ', dstrok: 'đ',
  Ecaron: 'Ě', ecaron: 'ě', Edot: 'Ė', edot: 'ė', Emacr: 'Ē', emacr: 'ē', ENG: 'Ŋ', eng: 'ŋ', Eogon: 'Ę', eogon: 'ę',
  Gbreve: 'Ğ', gbreve: 'ğ', Gcedil: 'Ģ', Gcirc: 'Ĝ', gcirc: 'ĝ', Gdot: 'Ġ', gdot: 'ġ', Hcirc: 'Ĥ', hcirc: 'ĥ',
  Hstrok: 'Ħ', hstrok: 'ħ', Idot: 'İ', IJlig: 'Ĳ', ijlig: 'ĳ', Imacr: 'Ī', imacr: 'ī', imath: 'ı', inodot: 'ı',
  Iogon: 'Į', iogon: 'į', Itilde: 'Ĩ', itilde: 'ĩ', Jcirc: 'Ĵ', jcirc: 'ĵ', Kcedil: 'Ķ', kcedil: 'ķ', kgreen: 'ĸ',
  Lacute: 'Ĺ', lacute: 'ĺ', Lcaron: 'Ľ', lcaron: 'ľ', Lcedil: 'Ļ', lcedil: 'ļ', Lmidot: 'Ŀ', lmidot: 'ŀ',
  Lstrok: 'Ł', lstrok: 'ł', Nacute: 'Ń', nacute: 'ń', napos: 'ŉ', Ncaron: 'Ň', ncaron: 'ň', Ncedil: 'Ņ', ncedil: 'ņ',
  Odblac: 'Ő', odblac: 'ő', Omacr: 'Ō', omacr: 'ō', Racute: 'Ŕ', racute: 'ŕ', Rcaron: 'Ř', rcaron: 'ř', Rcedil: 'Ŗ',
  rcedil: 'ŗ', Sacute: 'Ś', sacute: 'ś', Scedil: 'Ş', scedil: 'ş', Scirc: 'Ŝ', scirc: 'ŝ', Tcaron: 'Ť', tcaron: 'ť',
  Tcedil: 'Ţ', tcedil: 'ţ', Tstrok: 'Ŧ', tstrok: 'ŧ', Ubreve: 'Ŭ', ubreve: 'ŭ', Udblac: 'Ű', udblac: 'ű', Umacr: 'Ū',
  umacr: 'ū', Uogon: 'Ų', uogon: 'ų', Uring: 'Ů', uring: 'ů', Utilde: 'Ũ', utilde: 'ũ', Wcirc: 'Ŵ', wcirc: 'ŵ',
  Ycirc: 'Ŷ', ycirc: 'ŷ', Zacute: 'Ź', zacute: 'ź', Zcaron: 'Ž', zcaron: 'ž', Zdot: 'Ż', zdot: 'ż',
}

export const htmlEntities: Record<string, string> = { ...xhtml, ...latinExtendedA }
