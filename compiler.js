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

const Opcode = Enum(
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
	"BEGIN_IF",
	"THEN",
	"ELSE_IF",
	"END_IF"
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
		"%(((?<print_flags>((?<_pf>[-:+# ])(?!\\k<_pf>))*)",
		"(?:(?<print_width>[0-9]+)(?:\\.(?<print_precision>[0-9]+))?)?",
		"(?<print_format>[cdoxXs]))",
	].join(""),
	"(?:p(?<push_param>[0-9]))",
	// push or get variable
	"(?<var_op>[Pg][a-zA-Z])",
	"(\\'(?<character>.)\\')",
	"(\\{(?<integer>[0-9]+)\\})",
	// single-character instructions -> end instruction
	"(?<other_insn>[ilmAO?te;%+*/&|^=><!~-]))"
].join("|"), "g");

class Instruction {
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
		}
	};
	
	constructor(opcode) {
		this.opcode = Opcode(opcode);
		Object.assign(this, Instruction.#defaults?.[this.opcode.value]);
		Object.seal(this);
	}

	toString() {
		const result = [ this.opcode.key ];

		switch (this.opcode.value) {
			case Opcode.OUT:
				result.push(this.str);
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
		}

		return result.join(" ");
	}

	freeze() {
		return Object.freeze(this);
	}
}

function genOut(s) {
	const insn = new Instruction(Opcode.OUT);

	insn.str = s;

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

function genOpcode(code) {
	return new Instruction(code).freeze();
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

export default class TerminfoCompiler {
	// convert raw terminfo string to a list of instructions.
	// they are not to be executed directly, and need post-processing
	// with respect to control flow instructions and escapes
	static generateInstructions(s) {
		const instructions = [...s.matchAll(INSN_REGEX)].map(e => ({
			match: e[0],
			index: e.index,
			groups: e.groups
		}));

		const all = instructions.concat(inverseMatch(s, instructions))
			.sort((a, b) => a.index - b.index);

		const result = [];
		
		for (const insn of all) {
			if (insn.groups === undefined) {
				result.push(genOut(insn.match));
				continue;
			}
			if (insn.groups.delay_time !== undefined) {
				result.push(genDelay(insn.groups));
				continue;
			}
			if (insn.groups.print_format !== undefined) {
				result.push(genPrint(insn.groups));
				continue;
			}
			if (insn.groups.push_param !== undefined) {
				result.push(genParam(insn.groups));
				continue;
			}
			if (insn.groups.var_op !== undefined) {
				result.push(genVar(insn.groups));
				continue;
			}
			if (insn.groups.character !== undefined) {
				result.push(genConstant(insn.groups.character.charCodeAt(0)));
				continue;
			}
			if (insn.groups.integer !== undefined) {
				result.push(genConstant(Number(insn.groups.integer)));
				continue;
			}

			// other_insn must be set at this point;
			// the regex doesn't match invalid instructions at all and will ignore them
			switch (insn.groups.other_insn) {
				case "l": result.push(genOpcode(Opcode.STRLEN)); break;
				case "i": result.push(genOpcode(Opcode.PARAM_INC)); break;
				// math
				case "+": result.push(genOpcode(Opcode.ADD)); break;
				case "-": result.push(genOpcode(Opcode.SUBTRACT)); break;
				case "*": result.push(genOpcode(Opcode.MULTIPLY)); break;
				case "/": result.push(genOpcode(Opcode.DIVIDE)); break;
				case "m": result.push(genOpcode(Opcode.MODULO)); break;
				case "&": result.push(genOpcode(Opcode.AND)); break;
				case "|": result.push(genOpcode(Opcode.OR)); break;
				case "^": result.push(genOpcode(Opcode.XOR)); break;
				case "~": result.push(genOpcode(Opcode.NOT)); break;
				// logical operators
				case "=": result.push(genOpcode(Opcode.CMP_EQUAL)); break;
				case ">": result.push(genOpcode(Opcode.CMP_GREATER)); break;
				case "<": result.push(genOpcode(Opcode.CMP_LESS)); break;
				case "A": result.push(genOpcode(Opcode.CMP_AND)); break;
				case "O": result.push(genOpcode(Opcode.CMP_OR)); break;
				case "!": result.push(genOpcode(Opcode.CMP_NOT)); break;
				// control flow
				case "?": result.push(genOpcode(Opcode.BEGIN_IF)); break;
				case "t": result.push(genOpcode(Opcode.THEN)); break;
				case "e": result.push(genOpcode(Opcode.ELSE_IF)); break;
				case ";": result.push(genOpcode(Opcode.END_IF)); break;
			}
		}

		return result;
	}
}
