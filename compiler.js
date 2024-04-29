/* compiler.js - String capability compiler
 * Copyright (C) 2024  Marisa <private>
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import Enum from './enum.js';

import * as Errors from './errors.js';

export const Opcode = Enum(
	"INVALID",
	"OUT",
	"DELAY",
	"PRINT",
	"PUSH_PARAM",
	"SET_VAR",
	"PUSH_VAR",
	"CONSTANT",
	"STRLEN",
	"PARAM_INC",
	"ADD",
	"SUBTRACT",
	"MULTIPLY",
	"DIVIDE",
	"MODULO",
	"AND",
	"OR",
	"XOR",
	"NOT",
	"CMP_EQUAL",
	"CMP_GREATER",
	"CMP_LESS",
	"CMP_AND",
	"CMP_OR",
	"CMP_NOT",
	// flow control markers. not present in compiled instructions
	"TI_FLOW_BEGIN_IF",
	"TI_FLOW_THEN",
	"TI_FLOW_ELSE_IF",
	"TI_FLOW_END_IF",
	// actual flow control instructions
	"JUMP_ZERO",
	"JUMP"
);

// being able to do things like this is most of the reason
// I decided to write this project in javascript
const INSN_REGEX = new RegExp([
	// delay
	[
		"(?:\\$\\<(?<delay_time>[0-9]*(?:\\.[0-9])*)",
		"(?<delay_flags>(?:(?:(?<_df>[*/])(?!\\k<_df>))?){2})\\>)",
	].join(""),
	// instruction -> printf
	[
		// the first char must be ":" if you want to use + or - without other flags
		"%(((?<print_flags>(?<_pf1>[:# ])?(?:(?<_pf2>[-+# ])(?!\\k<_pf1>|\\k<_pf2>))*)",
		"(?:(?<print_width>[0-9]+)?(?:\\.(?<print_precision>[0-9]+))?)",
		"(?<print_format>[cdoxXs]))",
	].join(""),
	"(?:p(?<push_param>[0-9]))",
	// push or get variable
	"(?<var_op>[Pg][a-zA-Z])",
	// single char (collects escapes and control characters)
	/(\'(?<character>(?:\^.)|(?:\\(?:[\\\']|[^\\\']+))|[^\\\'])\')/.source,
	"(\\{(?<integer>[0-9]+)\\})",
	// single-character instructions -> end instruction
	"(?<other_insn>[ilmAO?te;%+*/&|^=><!~-]))"
].join("|"), "g");

export class Instruction {
	static #defaults = {
		[Opcode.OUT]: {
			str: ""
		},
		[Opcode.DELAY]: {
			time: 0,
			proportional: false,
			force: false
		},
		[Opcode.PRINT]: {
			format: "",
			zeroPad: false,
			alternateForm: false,
			leftJustify: false,
			positiveSignBlank: false,
			sign: false,
			width: 0,
			precision: 0
		},
		[Opcode.PUSH_PARAM]: {
			index: 0
		},
		[Opcode.SET_VAR]: {
			name: ""
		},
		[Opcode.PUSH_VAR]: {
			name: ""
		},
		[Opcode.CONSTANT]: {
			value: 0 // use charCodeAt for character constants
		},
		[Opcode.JUMP_ZERO]: {
			position: 0
		},
		[Opcode.JUMP]: {
			position: 0
		}
	};

	static opcode(c) {
		return new Instruction(c).freeze();
	}
	
	constructor(opcode, params) {
		this.opcode = Opcode(opcode);
		Object.assign(this, Instruction.#defaults?.[this.opcode.value]);
		Object.seal(this);

		if (params !== undefined) {
			Object.assign(this, params);
			Object.freeze(this);
		}
	}

	toString() {
		const result = [ this.opcode.key ];

		switch (this.opcode.value) {
			case Opcode.OUT:
				result.push(Deno.inspect(this.str));
				break;
			case Opcode.DELAY:
				result.push(String(this.time) +
					(this.proportional ? "*" : "") +
					(this.force ? "/" : ""));
				break;
			case Opcode.PRINT:
				result.push((this.alternateForm ? "#" : "") +
					(this.leftJustify ? "-" : "") +
					(this.positiveSignBlank ? " " : "") +
					(this.sign ? "+" : "") +
					(this.zeroPad ? "0" : "") +
					((this.width > 0) ? String(this.width) : "") +
					((this.precision > 0) ? ("." + String(this.precision)) : "") +
					this.format);
				break;
			case Opcode.PUSH_PARAM:
				result.push(String(this.index));
				break;
			case Opcode.SET_VAR:
			case Opcode.PUSH_VAR:
				result.push(this.name);
				break;
			case Opcode.CONSTANT:
				result.push(String(this.value));
				break;
			case Opcode.JUMP_ZERO:
			case Opcode.JUMP:
				result.push(String(this.position));
		}

		return result.join(" ");
	}

	freeze() {
		return Object.freeze(this);
	}
}

function handleEscapes(s) {
	return s
		.replace(/\^(.)/g, (_, m) =>
			String.fromCharCode(m === "?" ? 0x7F : m.charCodeAt(0) & 0x1F))
		.replace(/\\(\d{1,3})/g, (_, m) =>
			String.fromCharCode(parseInt(m, 8)))
		.replace(/\\[Ee]/g, String.fromCharCode(0x1B))
		.replace(/\\n/g,  "\r\n")
		.replace(/\\l/g,  "\n")
		.replace(/\\r/g,  "\r")
		.replace(/\\t/g,  "\t")
		.replace(/\\b/g,  "\b")
		.replace(/\\f/g,  "\f")
		.replace(/\\s/g,  " ")
		.replace(/\\^/g,  "^")
		.replace(/\\\\/g, "\\")
		.replace(/\\,/g,  ",")
		.replace(/\\:/g,  ":");
}

function genOut(s) {
	const insn = new Instruction(Opcode.OUT);

	insn.str = handleEscapes(s);

	return insn.freeze();
}

function genDelay(g) {
	const insn = new Instruction(Opcode.DELAY);

	insn.time = Number(g.delay_time);

	if (g.delay_flags === undefined)
		return insn.freeze();

	if (g.delay_flags.includes("*"))
		insn.proportional = true;

	if (g.delay_flags.includes("/"))
		insn.force = true;
	
	return insn.freeze();
}

function genPrint(g) {
	const insn = new Instruction(Opcode.PRINT);

	insn.format = g.print_format;

	if (g.print_width !== undefined) {
		let w = g.print_width;
		if (w[0] === "0") {
			insn.zeroPad = true;
			w = w.slice(1);
		}
		insn.width = Number(w);
	}

	if (g.print_precision !== undefined)
		insn.precision = Number(g.print_precision);

	if (g.print_flags === undefined)
		return insn.freeze();

	if (g.print_flags.includes("#"))
		insn.alternateForm = true;

	if (g.print_flags.includes("-"))
		insn.leftJustify = true;

	if (g.print_flags.includes(" "))
		insn.positiveSignBlank = true;

	if (g.print_flags.includes("+"))
		insn.sign = true;

	return insn.freeze();
}

function genParam(g) {
	const insn = new Instruction(Opcode.PUSH_PARAM);

	insn.index = Number(g.push_param);

	return insn.freeze();
}

function genVar(g) {
	const insn = new Instruction((g.var_op[0] === "P") ?
		Opcode.SET_VAR : Opcode.PUSH_VAR);

	insn.name = g.var_op[1];

	return insn.freeze();
}

function genConstant(n) {
	const insn = new Instruction(Opcode.CONSTANT);

	insn.value = n;

	return insn.freeze();
}

function inverseMatch(s, matches) {
	const result = [];
	let i = 0;

	if (matches.length === 0)
		return [ { index: 0, match: s } ];

	for (const match of matches) {
		result.push({ index: i, match: s.slice(i, match.index) });
		i += result.at(-1).match.length + match.match.length;
	}

	if (i < s.length)
		result.push({ index: i, match: s.slice(i) });

	return result.filter(m => (m.match.length > 0));
}

// convert flow control instructions to relative jumps
function convertFC(instructions) {
	const result = [], endJumpIndices = [];
	// endJumpPos being not const nags at me, but javascript
	// has no in-place map. I thought about writing my own but
	// that would just cost performance :\
	let i = 0, endJumpPos = [], chainJumpIndex, chainJumpPos = 0;

	for (; i < instructions.length; i++) {
		const insn = instructions[i];
		switch (insn.opcode.value) {
			case Opcode.TI_FLOW_BEGIN_IF: {
				const [skip, block] = convertFC(instructions.slice(i + 1));
				if (!Array.isArray(block))
					throw new Errors.ParseError("unexpected end of instructions");

				result.push(...block);
				chainJumpPos += block.length;
				endJumpPos = endJumpPos.map(pos => pos + block.length);
				i += skip;
				break;
			}
			case Opcode.TI_FLOW_THEN:
				result.push(new Instruction(Opcode.JUMP_ZERO));
				chainJumpPos = 0;
				chainJumpIndex = result.length - 1;
				endJumpPos = endJumpPos.map(pos => pos + 1);
				break;
			case Opcode.TI_FLOW_ELSE_IF:
				result[chainJumpIndex].position = chainJumpPos + 1;
				result[chainJumpIndex].freeze();
				chainJumpIndex = undefined; // protect against errors in the next case

				// these jumps target the end of the if construct.
				// executed at the end of a non-terminal conditional block between
				// %t and %e slash %;, they're resolved collectively at the end of the
				// terminal block
				result.push(new Instruction(Opcode.JUMP));
				endJumpPos = endJumpPos.map(pos => pos + 1);
				endJumpPos.push(0);
				endJumpIndices.push(result.length - 1);
				break;
			case Opcode.TI_FLOW_END_IF:
				if (chainJumpIndex !== undefined) {
					// no +1, because no extra jump instruction is generated here
					result[chainJumpIndex].position = chainJumpPos;
					result[chainJumpIndex].freeze();
				}

				if (endJumpIndices.length > 0) {
					for (let j = 0; j < endJumpIndices.length; j++) {
						result[endJumpIndices[j]].position = endJumpPos[j];
						result[endJumpIndices[j]].freeze();
					}
				}

				// NOTE to self: if this function returns this array to you,
				// you should report a parse error for too many end-if markers
				return [i + 1, result];
			default:
				chainJumpPos++;
				endJumpPos = endJumpPos.map(pos => pos + 1);
				result.push(insn);
		}
	}

	return result;
}

// convert raw terminfo string to a list of usable instructions
export function compile(s) {
	const instructions = [...s.matchAll(INSN_REGEX)].map(e => ({
		match: e[0],
		index: e.index,
		groups: e.groups
	}));

	const all = instructions.concat(inverseMatch(s, instructions))
		.sort((a, b) => a.index - b.index);

	const rawResult = [];
	
	for (const insn of all) {
		if (insn.groups === undefined) {
			rawResult.push(genOut(insn.match));
			continue;
		}
		if (insn.groups.delay_time !== undefined) {
			rawResult.push(genDelay(insn.groups));
			continue;
		}
		if (insn.groups.print_format !== undefined) {
			rawResult.push(genPrint(insn.groups));
			continue;
		}
		if (insn.groups.push_param !== undefined) {
			rawResult.push(genParam(insn.groups));
			continue;
		}
		if (insn.groups.var_op !== undefined) {
			rawResult.push(genVar(insn.groups));
			continue;
		}
		if (insn.groups.character !== undefined) {
			const e = handleEscapes(insn.groups.character);
			if (e.length > 1)
				throw new TypeError(`invalid character instruction %'${insn.groups.character}'`);
			rawResult.push(genConstant(e.charCodeAt(0)));
			continue;
		}
		if (insn.groups.integer !== undefined) {
			rawResult.push(genConstant(Number(insn.groups.integer)));
			continue;
		}

		// other_insn must be set at this point;
		// the regex doesn't match invalid instructions at all and will ignore them
		switch (insn.groups.other_insn) {
			case "%": rawResult.push(genOut("%")); break;
			case "l": rawResult.push(Instruction.opcode(Opcode.STRLEN)); break;
			case "i": rawResult.push(Instruction.opcode(Opcode.PARAM_INC)); break;
			// math
			case "+": rawResult.push(Instruction.opcode(Opcode.ADD)); break;
			case "-": rawResult.push(Instruction.opcode(Opcode.SUBTRACT)); break;
			case "*": rawResult.push(Instruction.opcode(Opcode.MULTIPLY)); break;
			case "/": rawResult.push(Instruction.opcode(Opcode.DIVIDE)); break;
			case "m": rawResult.push(Instruction.opcode(Opcode.MODULO)); break;
			case "&": rawResult.push(Instruction.opcode(Opcode.AND)); break;
			case "|": rawResult.push(Instruction.opcode(Opcode.OR)); break;
			case "^": rawResult.push(Instruction.opcode(Opcode.XOR)); break;
			case "~": rawResult.push(Instruction.opcode(Opcode.NOT)); break;
			// logical operators
			case "=": rawResult.push(Instruction.opcode(Opcode.CMP_EQUAL)); break;
			case ">": rawResult.push(Instruction.opcode(Opcode.CMP_GREATER)); break;
			case "<": rawResult.push(Instruction.opcode(Opcode.CMP_LESS)); break;
			case "A": rawResult.push(Instruction.opcode(Opcode.CMP_AND)); break;
			case "O": rawResult.push(Instruction.opcode(Opcode.CMP_OR)); break;
			case "!": rawResult.push(Instruction.opcode(Opcode.CMP_NOT)); break;
			// flow control markers
			case "?": rawResult.push(Instruction.opcode(Opcode.TI_FLOW_BEGIN_IF)); break;
			case "t": rawResult.push(Instruction.opcode(Opcode.TI_FLOW_THEN)); break;
			case "e": rawResult.push(Instruction.opcode(Opcode.TI_FLOW_ELSE_IF)); break;
			case ";": rawResult.push(Instruction.opcode(Opcode.TI_FLOW_END_IF)); break;
		}
	}

	return convertFC(rawResult);
}
